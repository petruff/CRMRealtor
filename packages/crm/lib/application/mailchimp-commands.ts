import { randomUUID } from 'node:crypto';
import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import type { MailchimpOperationRepository, MailchimpSetupRepository } from '../data/mailchimp-operation-repository.ts';
import type { ContactOutboundGuard } from '../data/contact-outbound-guard.ts';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import {
  MAILCHIMP_LEAD_TAGS,
  MAILCHIMP_TAG_MAPPING_VERSION,
  createMailchimpMemberOperation,
  parseMailchimpAudience,
  type MailchimpAudience,
  type MailchimpAudienceBinding,
  type MailchimpLeadType,
} from '../domain/mailchimp.ts';
import {
  isCanonicalWorkspaceOwnerScope,
  validateWorkspaceScope,
  type WorkspaceScope,
} from '../domain/workspace.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import { createConnectorIntentCommand } from './connector-commands.ts';

export interface MailchimpProviderClient {
  listAudiences(limit: number): Promise<readonly MailchimpAudience[]>;
}

export interface MailchimpProbeProviderClient {
  ping(): Promise<void>;
}

export interface MailchimpSetupProviderClient extends MailchimpProviderClient {
  createSignedAudienceWebhook(input: {
    readonly audienceId: string;
    readonly callbackUrl: string;
  }): Promise<{ readonly webhookId: string; readonly signingSecret: string }>;
  deleteAudienceWebhook(input: {
    readonly audienceId: string;
    readonly webhookId: string;
  }): Promise<void>;
  listAudienceMembers(input: {
    readonly audienceId: string;
    readonly count?: number;
    readonly offset?: number;
  }): Promise<{
    readonly members: readonly import('../domain/mailchimp.ts').MailchimpAudienceMember[];
    readonly totalItems: number;
  }>;
}

function enabledMailchimp(configuration: ConnectorRuntimeConfiguration) {
  const definition = configuration.definitions.find((item) => item.provider === 'mailchimp');
  if (!definition?.enabled || !['uat', 'live'].includes(definition.mode)) {
    throw new ConnectorError('provider-disabled', 'Mailchimp is not enabled in this deployment.');
  }
  return definition;
}

export async function listMailchimpAudiencesCommand(
  repository: ConnectorRepository,
  client: MailchimpProviderClient,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { readonly connectionId?: unknown; readonly limit?: unknown },
) {
  const scope = validateWorkspaceScope(scopeInput);
  enabledMailchimp(configuration);
  if (!isCanonicalWorkspaceOwnerScope(scope)) throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  if (typeof input.connectionId !== 'string' || !input.connectionId.trim()) {
    throw new ConnectorError('invalid-input', 'connectionId is required.');
  }
  const connection = await repository.getConnection(scope, input.connectionId.trim());
  if (!connection || connection.provider !== 'mailchimp') {
    throw new ConnectorError('not-found', 'Mailchimp connection was not found.');
  }
  if (!['active', 'degraded'].includes(connection.status)) {
    throw new ConnectorError('forbidden', 'Mailchimp connection is not available.');
  }
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ConnectorError('invalid-input', 'limit must be 1–500.');
  }
  const audiences = await client.listAudiences(limit);
  return audiences.map(parseMailchimpAudience);
}

export async function listLiveMailchimpAudiencesCommand(
  operations: MailchimpOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { readonly connectionId?: unknown; readonly limit?: unknown },
  dependencies: {
    readonly resolver?: ConnectorKekResolver;
    readonly createClient: (dataCenter: string, token: string) => MailchimpProviderClient;
  },
) {
  const scope = validateWorkspaceScope(scopeInput);
  enabledMailchimp(configuration);
  if (scope.mode !== 'live' || !isCanonicalWorkspaceOwnerScope(scope)) {
    throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  }
  if (typeof input.connectionId !== 'string' || !input.connectionId.trim()) {
    throw new ConnectorError('invalid-input', 'connectionId is required.');
  }
  const connectionId = input.connectionId.trim();
  const limit = input.limit === undefined ? 100 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ConnectorError('invalid-input', 'limit must be 1–500.');
  }
  const authority = await operations.readConnectionAuthority(scope, connectionId);
  if (authority.workspaceId !== scope.workspaceId || authority.connectionId !== connectionId) {
    throw new ConnectorError('forbidden', 'Mailchimp connection authority is invalid.');
  }
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const token = decryptConnectorSecret(authority.accessTokenEnvelope, {
    workspaceId: scope.workspaceId, connectionId, provider: 'mailchimp',
    secretType: 'mailchimp-access-token', recordVersion: authority.secretVersion,
  }, resolver);
  return (await dependencies.createClient(authority.dataCenter, token).listAudiences(limit))
    .map(parseMailchimpAudience);
}

export function selectMailchimpAudienceCommand(
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId?: unknown;
    readonly accountIdHash?: unknown;
    readonly dataCenter?: unknown;
    readonly audience?: unknown;
  },
  now = new Date(),
): MailchimpAudienceBinding {
  const scope = validateWorkspaceScope(scopeInput);
  if (!isCanonicalWorkspaceOwnerScope(scope)) throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  const connectionId = typeof input.connectionId === 'string' ? input.connectionId.trim() : '';
  const accountIdHash = typeof input.accountIdHash === 'string' ? input.accountIdHash.trim() : '';
  const dataCenter = typeof input.dataCenter === 'string' ? input.dataCenter.trim().toLowerCase() : '';
  if (!connectionId || !/^[0-9a-f]{64}$/.test(accountIdHash) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dataCenter)) {
    throw new ConnectorError('invalid-input', 'Mailchimp account binding is invalid.');
  }
  const audience = parseMailchimpAudience(input.audience);
  return {
    connectionId,
    accountIdHash,
    dataCenter,
    audienceId: audience.id,
    audienceName: audience.name,
    mappingVersion: MAILCHIMP_TAG_MAPPING_VERSION,
    selectedAt: now.toISOString(),
  };
}

export async function persistMailchimpAudienceSelectionCommand(
  operations: MailchimpOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { readonly connectionId?: unknown; readonly audience?: unknown; readonly correlationId: string },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  enabledMailchimp(configuration);
  if (scope.mode !== 'live' || !isCanonicalWorkspaceOwnerScope(scope)) {
    throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  }
  const connectionId = typeof input.connectionId === 'string' ? input.connectionId.trim() : '';
  if (!connectionId) throw new ConnectorError('invalid-input', 'connectionId is required.');
  const authority = await operations.readConnectionAuthority(scope, connectionId);
  const audience = parseMailchimpAudience(input.audience);
  return operations.selectAudience(scope, {
    connectionId, accountIdHash: authority.accountIdHash, dataCenter: authority.dataCenter,
    audience, mappingVersion: MAILCHIMP_TAG_MAPPING_VERSION,
    correlationId: input.correlationId, selectedAt: now.toISOString(),
  });
}

async function liveMailchimpAuthority<Client extends MailchimpProviderClient>(
  operations: MailchimpOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  connectionId: string,
  dependencies: {
    readonly resolver?: ConnectorKekResolver;
    readonly createClient: (dataCenter: string, token: string) => Client;
  },
) {
  const scope = validateWorkspaceScope(scopeInput);
  enabledMailchimp(configuration);
  if (scope.mode !== 'live' || !isCanonicalWorkspaceOwnerScope(scope)) {
    throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  }
  const authority = await operations.readConnectionAuthority(scope, connectionId);
  if (authority.workspaceId !== scope.workspaceId || authority.connectionId !== connectionId) {
    throw new ConnectorError('forbidden', 'Mailchimp connection authority is invalid.');
  }
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const token = decryptConnectorSecret(authority.accessTokenEnvelope, {
    workspaceId: scope.workspaceId, connectionId, provider: 'mailchimp',
    secretType: 'mailchimp-access-token', recordVersion: authority.secretVersion,
  }, resolver);
  return { scope, authority, resolver, client: dependencies.createClient(authority.dataCenter, token) };
}

function probeFailure(error: unknown): {
  readonly status: 'degraded' | 'reauthorization-required';
  readonly errorCategory: 'authorization_revoked' | 'rate_limited' | 'provider_unavailable' | 'internal_error';
} {
  if (error instanceof ConnectorError && error.code === 'forbidden') {
    return { status: 'reauthorization-required', errorCategory: 'authorization_revoked' };
  }
  if (error instanceof ConnectorError && error.code === 'provider-retryable') {
    return { status: 'degraded', errorCategory: 'rate_limited' };
  }
  if (error instanceof ConnectorError && error.code === 'provider-disabled') {
    return { status: 'degraded', errorCategory: 'provider_unavailable' };
  }
  return { status: 'degraded', errorCategory: 'internal_error' };
}

/** Executes Mailchimp's read-only provider health endpoint and persists a redacted receipt. */
export async function probeLiveMailchimpConnectionCommand(
  operations: MailchimpOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { readonly connectionId: string; readonly correlationId: string },
  dependencies: {
    readonly resolver?: ConnectorKekResolver;
    readonly createClient: (dataCenter: string, token: string) => MailchimpProviderClient & MailchimpProbeProviderClient;
  },
  now = new Date(),
) {
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  const connectionId = input.connectionId.trim();
  if (!connectionId) throw new ConnectorError('invalid-input', 'connectionId is required.');
  const live = await liveMailchimpAuthority(operations, configuration, scopeInput, connectionId, dependencies);
  let failure: ReturnType<typeof probeFailure> | undefined;
  try { await live.client.ping(); } catch (error) { failure = probeFailure(error); }
  const recorded = await operations.recordProbe(live.scope, {
    connectionId,
    status: failure?.status ?? 'active',
    accountIdHash: live.authority.accountIdHash,
    grantedScopes: live.authority.grantedScopes,
    occurredAt: now.toISOString(),
    errorCategory: failure?.errorCategory ?? 'none',
    correlationId: input.correlationId,
  });
  return failure ? {
    connectionId,
    healthy: false as const,
    status: recorded.status,
    probedAt: recorded.occurredAt,
    errorCategory: failure.errorCategory,
  } : {
    connectionId,
    healthy: true as const,
    status: recorded.status,
    probedAt: recorded.occurredAt,
  };
}

/** Creates the selected-audience callback and persists its one-time signing secret encrypted. */
export async function setupMailchimpSignedWebhookCommand(
  operations: MailchimpSetupRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly webhookBaseUrl: string;
    readonly correlationId: string;
  },
  dependencies: {
    readonly resolver?: ConnectorKekResolver;
    readonly createClient: (dataCenter: string, token: string) => MailchimpSetupProviderClient;
    readonly createEndpointKey?: () => string;
  },
  now = new Date(),
) {
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  const connectionId = input.connectionId.trim();
  if (!connectionId) throw new ConnectorError('invalid-input', 'connectionId is required.');
  const binding = await operations.getSelectedAudience(validateWorkspaceScope(scopeInput), connectionId);
  if (!binding) throw new ConnectorError('not-found', 'Select a Mailchimp audience first.');
  const live = await liveMailchimpAuthority(operations, configuration, scopeInput, connectionId, dependencies);
  const setup = await operations.readSetupState(connectionId);
  if (setup.workspaceId !== live.scope.workspaceId || setup.connectionId !== connectionId) {
    throw new ConnectorError('forbidden', 'Mailchimp webhook setup authority is invalid.');
  }
  const endpointKey = dependencies.createEndpointKey?.() ?? randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(endpointKey)) {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook endpoint key is invalid.');
  }
  let base: URL;
  try { base = new URL(input.webhookBaseUrl); } catch { throw new ConnectorError('configuration-required', 'Mailchimp webhook base URL is invalid.'); }
  if (!base.pathname.endsWith('/api/connectors/mailchimp/webhook') || base.search || base.hash) {
    throw new ConnectorError('configuration-required', 'Mailchimp webhook base URL is invalid.');
  }
  base.pathname = `${base.pathname.replace(/\/$/, '')}/${endpointKey}`;
  const remote = await live.client.createSignedAudienceWebhook({ audienceId: binding.audienceId, callbackUrl: base.toString() });
  const secretVersion = (setup.secretVersion ?? 0) + 1;
  const secretEnvelope = encryptConnectorSecret(remote.signingSecret, {
    workspaceId: live.scope.workspaceId, connectionId, provider: 'mailchimp',
    secretType: 'mailchimp-webhook-signing-secret', recordVersion: secretVersion,
  }, live.resolver);
  let persisted: Awaited<ReturnType<MailchimpSetupRepository['bindSigningSecret']>>;
  try {
    persisted = await operations.bindSigningSecret({
      connectionId, endpointKeyHash: sha256Hex(endpointKey),
      ...(setup.secretVersion ? { expectedSecretVersion: setup.secretVersion } : {}),
      webhookIdHash: sha256Hex(remote.webhookId), envelope: secretEnvelope,
      occurredAt: now.toISOString(), correlationId: input.correlationId,
    });
  } catch (persistenceError) {
    try {
      await live.client.deleteAudienceWebhook({
        audienceId: binding.audienceId,
        webhookId: remote.webhookId,
      });
    } catch {
      throw new ConnectorError(
        'conflict',
        'Mailchimp webhook persistence failed and remote cleanup could not be confirmed. Remove the webhook in Mailchimp before retrying.',
      );
    }
    throw persistenceError;
  }
  return {
    connectionId,
    audienceIdHash: stablePayloadHash(binding.audienceId),
    secretVersion: persisted.secretVersion,
    ready: true as const,
    noOp: persisted.noOp,
  };
}

/**
 * Legacy bounded page helper retained for deterministic tests and compatibility.
 * Live UI/CLI execution must request the durable leased reconciliation service.
 */
export async function reconcileMailchimpBaselinePageCommand(
  operations: MailchimpSetupRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly correlationId: string;
  },
  dependencies: {
    readonly resolver?: ConnectorKekResolver;
    readonly createClient: (dataCenter: string, token: string) => MailchimpSetupProviderClient;
  },
  now = new Date(),
) {
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  const connectionId = input.connectionId.trim();
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;
  if (!connectionId || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ConnectorError('invalid-input', 'Mailchimp baseline page is invalid.');
  }
  const binding = await operations.getSelectedAudience(validateWorkspaceScope(scopeInput), connectionId);
  if (!binding?.id) throw new ConnectorError('not-found', 'Select a Mailchimp audience first.');
  const live = await liveMailchimpAuthority(operations, configuration, scopeInput, connectionId, dependencies);
  const page = await live.client.listAudienceMembers({ audienceId: binding.audienceId, count: limit, offset });
  const counts: Record<string, number> = {};
  for (const member of page.members) {
    const sourceHash = stablePayloadHash({
      connectionId, audienceId: binding.audienceId, memberId: member.memberId,
      subscriberHash: member.subscriberHash, status: member.subscriptionStatus, lastChangedAt: member.lastChangedAt,
    });
    const result = await operations.applyBaselineMember({
      connectionId, audienceId: binding.audienceId, member, sourceHash,
      correlationId: input.correlationId, occurredAt: member.lastChangedAt,
    });
    counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
  }
  const nextOffset = offset + page.members.length;
  const complete = nextOffset >= page.totalItems;
  if (complete) {
    await operations.completeBaseline({
      connectionId, bindingId: binding.id,
      providerRequestHash: stablePayloadHash({ connectionId, audienceId: binding.audienceId, totalItems: page.totalItems }),
      correlationId: input.correlationId, occurredAt: now.toISOString(),
    });
  }
  return {
    connectionId,
    audienceIdHash: stablePayloadHash(binding.audienceId),
    offset,
    processed: page.members.length,
    totalItems: page.totalItems,
    nextOffset: complete ? undefined : nextOffset,
    complete,
    outcomes: counts,
  };
}

export function previewMailchimpTagSyncCommand(input: {
  readonly binding: MailchimpAudienceBinding;
  readonly contacts: readonly {
    readonly normalizedEmail: string;
    readonly leadType: MailchimpLeadType;
  }[];
}) {
  const operations = input.contacts.map((contact) => createMailchimpMemberOperation({
    audienceId: input.binding.audienceId,
    normalizedEmail: contact.normalizedEmail,
    leadType: contact.leadType,
  }));
  return {
    audienceId: input.binding.audienceId,
    audienceName: input.binding.audienceName,
    mappingVersion: MAILCHIMP_TAG_MAPPING_VERSION,
    mapping: MAILCHIMP_LEAD_TAGS,
    count: operations.length,
    snapshotHash: stablePayloadHash(operations),
    operationKeys: operations.map((operation) => operation.operationKey),
    containsRawEmails: false as const,
  };
}

export async function createMailchimpTagSyncIntentCommand(
  repository: ConnectorRepository,
  configuration: ConnectorRuntimeConfiguration,
  scope: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly binding: MailchimpAudienceBinding;
    readonly payloadReference: string;
    readonly payloadHash?: string;
    readonly contacts: readonly { readonly normalizedEmail: string; readonly leadType: MailchimpLeadType }[];
    readonly policyId: string;
    readonly policyVersion: number;
    readonly correlationId?: string;
    readonly contactId?: string;
    readonly contactPointId?: string;
    readonly reviewedAliasEpoch?: number;
  },
  now = new Date(),
) {
  const preview = previewMailchimpTagSyncCommand({ binding: input.binding, contacts: input.contacts });
  return createConnectorIntentCommand(repository, configuration, scope, {
    provider: 'mailchimp',
    connectionId: input.connectionId,
    actionType: 'audience.sync',
    payloadReference: input.payloadReference,
    payloadHash: input.payloadHash ?? preview.snapshotHash,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    correlationId: input.correlationId,
    summary: `Synchronize ${preview.count} contact tag${preview.count === 1 ? '' : 's'} with ${preview.audienceName}.`,
    complianceSnapshot: {
      audienceIdHash: stablePayloadHash(preview.audienceId),
      mappingVersion: preview.mappingVersion,
      count: preview.count,
      snapshotHash: preview.snapshotHash,
      ...(input.contactId && input.contactPointId && input.reviewedAliasEpoch !== undefined ? {
        contactId: input.contactId, contactPointId: input.contactPointId,
        aliasEpoch: input.reviewedAliasEpoch,
      } : {}),
    },
  }, now);
}

/** Stores one encrypted, selected-audience operation before creating its governed intent. */
export async function prepareMailchimpTagSyncIntentCommand(
  connectorRepository: ConnectorRepository,
  operations: MailchimpOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly contactId: string;
    readonly contactPointId: string;
    readonly normalizedEmail: string;
    readonly leadType: MailchimpLeadType;
    readonly correlationId: string;
  },
  dependencies: { readonly resolver?: ConnectorKekResolver; readonly outboundGuard: ContactOutboundGuard },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  enabledMailchimp(configuration);
  if (scope.mode !== 'live') throw new ConnectorError('forbidden', 'Live workspace authority is required.');
  const reviewedTarget = await dependencies.outboundGuard.assertTarget(scope, input.contactId, input.contactPointId);
  const binding = await operations.getSelectedAudience(scope, input.connectionId);
  if (!binding) throw new ConnectorError('not-found', 'Select a Mailchimp audience first.');
  const operation = createMailchimpMemberOperation({
    audienceId: binding.audienceId, normalizedEmail: input.normalizedEmail, leadType: input.leadType,
  });
  if (!await operations.hasLinkedMember(scope, {
    connectionId: input.connectionId, subscriberHash: operation.subscriberHash,
  })) {
    throw new ConnectorError('conflict', 'Mailchimp member identity must be linked before tag synchronization.');
  }
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify({ ...operation, contactId: input.contactId,
    contactPointId: input.contactPointId, reviewedAliasEpoch: reviewedTarget.aliasEpoch }), {
    workspaceId: scope.workspaceId, connectionId: input.connectionId, provider: 'mailchimp',
    secretType: 'audience.sync', recordVersion: 1,
  }, resolver);
  const stored = await operations.storeOperation(scope, {
    connectionId: input.connectionId, operation, envelope,
  });
  const policy = await operations.ensureSyncPolicy(scope, {
    correlationId: input.correlationId, occurredAt: now.toISOString(),
  });
  return createMailchimpTagSyncIntentCommand(connectorRepository, configuration, scope, {
    connectionId: input.connectionId, binding, payloadReference: stored.payloadReference,
    payloadHash: stored.payloadHash,
    contacts: [{ normalizedEmail: input.normalizedEmail, leadType: input.leadType }],
    policyId: policy.id, policyVersion: policy.version, correlationId: input.correlationId,
    contactId: input.contactId, contactPointId: input.contactPointId,
    reviewedAliasEpoch: reviewedTarget.aliasEpoch,
  }, now);
}
