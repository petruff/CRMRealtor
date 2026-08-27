import type { SupabaseClient } from '@supabase/supabase-js';
import { createMailchimpServerRepository } from '../data/mailchimp-operation-server-context.ts';
import { createGoogleOperationServerRepository } from '../data/google-operation-server-context.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import type { GoogleCapabilityState } from '../data/google-operation-repository.ts';
import type { MailchimpOutboundBackfillRun } from '../data/mailchimp-outbound-backfill-repository.ts';
import type { MailchimpReconciliationRun } from '../data/supabase-mailchimp-reconciliation-repository.ts';
import type { ConnectorConnection, ConnectorDefinition } from '../domain/connector.ts';
import type { ConnectorLifecycleProjection, LifecycleProvider } from '../domain/connector-lifecycle.ts';
import type { MailchimpAudience, MailchimpAudienceBinding } from '../domain/mailchimp.ts';
import { loadMailchimpConfiguredRuntimeConfiguration } from '../config/connector-runtime.ts';
import { MailchimpMarketingClient } from '../providers/mailchimp-client.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createSupabaseServerClient } from '../supabase/server.ts';
import {
  readGoogleLifecycle,
  readMailchimpLifecycle,
  type ConnectorLifecycleReadFailure,
} from './connector-lifecycle-projection.ts';
import { listLiveMailchimpAudiencesCommand } from './mailchimp-commands.ts';

const MAILCHIMP_REQUIRED_SCOPES = ['audience.sync', 'audience.reconcile'] as const;

export interface ConnectorLifecycleProviderReaders {
  readonly readGoogleCapabilities: (connectionId: string) => Promise<GoogleCapabilityState>;
  readonly readGoogleOwnerBinding: (connectionId: string) => Promise<boolean>;
  readonly readMailchimpAuthorization: (connectionId: string) => Promise<boolean>;
  readonly readMailchimpOwnerBinding: (connectionId: string) => Promise<boolean>;
  readonly readMailchimpBinding: (connectionId: string) => Promise<MailchimpAudienceBinding | undefined>;
  readonly readMailchimpReconciliations: (connectionId: string) => Promise<readonly MailchimpReconciliationRun[]>;
  readonly readMailchimpBackfills: (connectionId: string) => Promise<readonly MailchimpOutboundBackfillRun[]>;
  readonly readMailchimpAudiences?: (connectionId: string) => Promise<readonly MailchimpAudience[]>;
}

export interface ConnectorLifecycleSnapshot {
  readonly definitions: readonly ConnectorDefinition[];
  readonly connections: readonly ConnectorConnection[];
  readonly lifecycles: readonly ConnectorLifecycleProjection[];
  readonly google: {
    readonly lifecycle: ConnectorLifecycleProjection;
    readonly capabilityState?: GoogleCapabilityState;
    readonly failures: readonly ConnectorLifecycleReadFailure[];
  };
  readonly mailchimp: {
    readonly lifecycle: ConnectorLifecycleProjection;
    readonly binding?: MailchimpAudienceBinding;
    readonly reconciliation?: MailchimpReconciliationRun;
    readonly backfills: readonly MailchimpOutboundBackfillRun[];
    readonly audiences: readonly MailchimpAudience[];
    readonly failures: readonly ConnectorLifecycleReadFailure[];
  };
}

export function connectorLifecycleReadiness(
  lifecycles: readonly ConnectorLifecycleProjection[],
) {
  return lifecycles.map((lifecycle) => ({
    id: `connector-${lifecycle.provider}`,
    configured: lifecycle.state !== 'not-configured',
    status: lifecycle.state,
  }));
}

interface CanonicalOwnerRow {
  readonly id: string;
  readonly user_id: string;
  readonly role: string;
  readonly status: string;
}

function connectionFor(
  connections: readonly ConnectorConnection[],
  provider: LifecycleProvider,
): ConnectorConnection | undefined {
  return connections.find((connection) => connection.provider === provider);
}

function definitionFor(
  definitions: readonly ConnectorDefinition[],
  provider: LifecycleProvider,
): ConnectorDefinition | undefined {
  return definitions.find((definition) => definition.provider === provider);
}

async function canonicalOwnerMembership(
  client: SupabaseClient,
  scope: WorkspaceScope,
  membershipId: string,
): Promise<boolean> {
  const { data, error } = await client.from('workspace_members')
    .select('id,user_id,role,status')
    .eq('workspace_id', scope.workspaceId)
    .eq('id', membershipId)
    .maybeSingle();
  if (error) throw new Error('Canonical-owner membership evidence is unavailable.');
  const row = data as CanonicalOwnerRow | null;
  return row?.id === membershipId
    && row.user_id === scope.ownerUserId
    && row.role === 'owner'
    && row.status === 'active';
}

async function readGoogleOwnerBinding(
  client: SupabaseClient,
  scope: WorkspaceScope,
  connectionId: string,
): Promise<boolean> {
  const { data, error } = await client.from('google_oauth_completions')
    .select('actor_user_id,actor_membership_id')
    .eq('workspace_id', scope.workspaceId)
    .eq('connection_id', connectionId)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Google owner-binding evidence is unavailable.');
  const row = data as { actor_user_id?: unknown; actor_membership_id?: unknown } | null;
  if (typeof row?.actor_user_id !== 'string' || typeof row.actor_membership_id !== 'string') return false;
  return row.actor_user_id === scope.ownerUserId
    && canonicalOwnerMembership(client, scope, row.actor_membership_id);
}

export async function readMailchimpCanonicalOwnerAuthorization(
  client: SupabaseClient,
  scope: WorkspaceScope,
  connectionId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('read_mailchimp_owner_authorization_evidence', {
    target_connection_id: connectionId,
  });
  if (error || typeof data !== 'boolean') {
    throw new Error('Mailchimp owner-binding evidence is unavailable.');
  }
  return data;
}

async function readMailchimpAuthorizationEvidence(
  client: SupabaseClient,
  scope: WorkspaceScope,
  connectionId: string,
): Promise<boolean> {
  const connection = await client.from('connector_connections')
    .select('id,status,granted_scopes')
    .eq('workspace_id', scope.workspaceId)
    .eq('id', connectionId)
    .eq('provider', 'mailchimp')
    .maybeSingle();
  if (connection.error) {
    throw new Error('Mailchimp authorization evidence is unavailable.');
  }
  const row = connection.data as { id?: unknown; status?: unknown; granted_scopes?: unknown } | null;
  const grantedScopes = Array.isArray(row?.granted_scopes) ? row.granted_scopes : [];
  return row?.id === connectionId
    && row.status === 'active'
    && MAILCHIMP_REQUIRED_SCOPES.every((requiredScope) => grantedScopes.includes(requiredScope));
}

async function defaultProviderReaders(input: {
  readonly scope: WorkspaceScope;
  readonly includeMailchimpAudiences: boolean;
}): Promise<ConnectorLifecycleProviderReaders> {
  const authenticated = await createSupabaseServerClient();
  const google = createGoogleOperationServerRepository({ authenticated });
  const mailchimp = createMailchimpServerRepository({ authenticated });
  const mailchimpOwnerAuthorizations = new Map<string, Promise<boolean>>();
  const readMailchimpOwnerAuthorization = (connectionId: string) => {
    const existing = mailchimpOwnerAuthorizations.get(connectionId);
    if (existing) return existing;
    const current = readMailchimpCanonicalOwnerAuthorization(authenticated, input.scope, connectionId);
    mailchimpOwnerAuthorizations.set(connectionId, current);
    return current;
  };
  return {
    readGoogleCapabilities: (connectionId) => google.readCapabilityState(input.scope, connectionId),
    readGoogleOwnerBinding: (connectionId) => readGoogleOwnerBinding(authenticated, input.scope, connectionId),
    readMailchimpAuthorization: (connectionId) => readMailchimpAuthorizationEvidence(
      authenticated,
      input.scope,
      connectionId,
    ),
    readMailchimpOwnerBinding: readMailchimpOwnerAuthorization,
    readMailchimpBinding: (connectionId) => mailchimp.operations.getSelectedAudience(input.scope, connectionId),
    readMailchimpReconciliations: (connectionId) => mailchimp.reconciliations.list(input.scope, connectionId, 1),
    readMailchimpBackfills: (connectionId) => mailchimp.outboundBackfills.list(input.scope, connectionId, 5),
    ...(input.includeMailchimpAudiences ? {
      readMailchimpAudiences: (connectionId) => listLiveMailchimpAudiencesCommand(
        mailchimp.operations,
        loadMailchimpConfiguredRuntimeConfiguration(),
        input.scope,
        { connectionId, limit: 500 },
        { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
      ),
    } : {}),
  };
}

export async function readConnectorLifecycleSnapshot(input: {
  readonly connectorRepository: ConnectorRepository;
  readonly workspaceScope: WorkspaceScope;
  readonly isLive: boolean;
  readonly definitions?: readonly ConnectorDefinition[];
  readonly connections?: readonly ConnectorConnection[];
  readonly observedAt?: Date;
  readonly includeMailchimpAudiences?: boolean;
  readonly readers?: ConnectorLifecycleProviderReaders;
}): Promise<ConnectorLifecycleSnapshot> {
  const [definitions, connections] = await Promise.all([
    input.definitions ?? input.connectorRepository.listDefinitions(input.workspaceScope),
    input.connections ?? input.connectorRepository.listConnections(input.workspaceScope, { limit: 100 }),
  ]);
  const googleConnection = connectionFor(connections, 'google');
  const mailchimpConnection = connectionFor(connections, 'mailchimp');
  let readers = input.readers;
  if (input.isLive && (googleConnection || mailchimpConnection) && !readers) {
    try {
      readers = await defaultProviderReaders({
        scope: input.workspaceScope,
        includeMailchimpAudiences: input.includeMailchimpAudiences === true,
      });
    } catch {
      readers = undefined;
    }
  }
  const [google, mailchimp] = await Promise.all([
    readGoogleLifecycle({
      definition: definitionFor(definitions, 'google'),
      connection: googleConnection,
      observedAt: input.observedAt,
      ...(googleConnection && readers ? {
        readCapabilities: () => readers!.readGoogleCapabilities(googleConnection.id),
        readOwnerAuthorization: () => readers!.readGoogleOwnerBinding(googleConnection.id),
      } : {}),
    }),
    readMailchimpLifecycle({
      definition: definitionFor(definitions, 'mailchimp'),
      connection: mailchimpConnection,
      observedAt: input.observedAt,
      ...(mailchimpConnection && readers ? {
        readAuthorization: () => readers!.readMailchimpAuthorization(mailchimpConnection.id),
        readOwnerAuthorization: () => readers!.readMailchimpOwnerBinding(mailchimpConnection.id),
        readBinding: () => readers!.readMailchimpBinding(mailchimpConnection.id),
        readReconciliation: () => readers!.readMailchimpReconciliations(mailchimpConnection.id),
        readBackfills: () => readers!.readMailchimpBackfills(mailchimpConnection.id),
        ...(readers.readMailchimpAudiences
          ? { readAudiences: () => readers!.readMailchimpAudiences!(mailchimpConnection.id) }
          : {}),
      } : {}),
    }),
  ]);
  return {
    definitions,
    connections,
    lifecycles: [google.projection, mailchimp.projection],
    google: {
      lifecycle: google.projection,
      ...(google.capabilityState ? { capabilityState: google.capabilityState } : {}),
      failures: google.failures,
    },
    mailchimp: {
      lifecycle: mailchimp.projection,
      ...(mailchimp.binding ? { binding: mailchimp.binding } : {}),
      ...(mailchimp.reconciliation ? { reconciliation: mailchimp.reconciliation } : {}),
      backfills: mailchimp.backfills,
      audiences: mailchimp.audiences ?? [],
      failures: mailchimp.failures,
    },
  };
}
