import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  CONNECTOR_CONNECTION_STATUSES,
  CONNECTOR_ERROR_CATEGORIES,
  CONNECTOR_JOB_STATES,
  CONNECTOR_INTENT_STATUSES,
  CONNECTOR_PROVIDERS,
  CONNECTOR_RECEIPT_TYPES,
  ConnectorError,
  type ConnectorActionIntent,
  type ConnectorConnection,
  type ConnectorConnectionStatus,
  type ConnectorDefinition,
  type ConnectorErrorCategory,
  type ConnectorJob,
  type ConnectorJobState,
  type ConnectorProvider,
  type ConnectorReceipt,
  type ConnectorReceiptType,
} from '../domain/connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ConnectorRepository } from './connector-repository.ts';

interface ConnectionRow {
  id: string;
  workspace_id: string;
  provider: string;
  provider_account_key_hash: string | null;
  display_label: string;
  status: string;
  granted_scopes: string[];
  last_probe_at: string | null;
  created_at: string;
  updated_at: string;
  disconnected_at: string | null;
}

interface IntentRow {
  id: string;
  workspace_id: string;
  connection_id: string;
  provider: string;
  action_type: string;
  summary: string;
  state: string;
  current_version: number;
  created_by_membership_id: string;
  created_at: string;
  updated_at: string;
}

interface IntentVersionRow {
  intent_id: string;
  version: number;
  payload_ref: string;
  payload_hash: string;
}

interface JobRow {
  id: string;
  workspace_id: string;
  intent_id: string;
  intent_version: number;
  provider: string;
  action_type: string;
  payload_ref: string;
  idempotency_key: string;
  correlation_id: string;
  state: string;
  attempt_count: number;
  max_attempts: number;
  scheduled_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fencing_token: number | string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ReceiptRow {
  id: string;
  workspace_id: string;
  provider: string;
  intent_id: string | null;
  job_id: string | null;
  attempt_number: number | null;
  event_type: string;
  correlation_id: string;
  provider_request_hash: string | null;
  remote_operation_id: string | null;
  provider_status: string | null;
  error_category: string | null;
  redacted_metadata: Record<string, unknown> | null;
  occurred_at: string;
}

const CONNECTION_COLUMNS = [
  'id', 'workspace_id', 'provider', 'provider_account_key_hash', 'display_label',
  'status', 'granted_scopes', 'last_probe_at', 'created_at', 'updated_at', 'disconnected_at',
].join(', ');
const INTENT_COLUMNS = [
  'id', 'workspace_id', 'connection_id', 'provider', 'action_type', 'summary',
  'state', 'current_version', 'created_by_membership_id', 'created_at', 'updated_at',
].join(', ');
const VERSION_COLUMNS = 'intent_id, version, payload_ref, payload_hash';
const JOB_COLUMNS = [
  'id', 'workspace_id', 'intent_id', 'intent_version', 'provider', 'action_type',
  'payload_ref', 'idempotency_key', 'correlation_id', 'state', 'attempt_count',
  'max_attempts', 'scheduled_at', 'lease_owner', 'lease_expires_at', 'fencing_token',
  'created_at', 'updated_at', 'completed_at',
].join(', ');
const RECEIPT_COLUMNS = [
  'id', 'workspace_id', 'provider', 'intent_id', 'job_id', 'attempt_number',
  'event_type', 'correlation_id', 'provider_request_hash', 'remote_operation_id',
  'provider_status', 'error_category', 'redacted_metadata', 'occurred_at',
].join(', ');

function liveScope(scope: WorkspaceScope): WorkspaceScope {
  const valid = validateWorkspaceScope(scope);
  if (valid.mode !== 'live') throw new ConnectorError('forbidden', 'Supabase connectors require live mode.');
  return valid;
}

function persistenceError(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) {
    return new ConnectorError('invalid-input', message);
  }
  return new Error(`${message}: persistence failed.`);
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('conflict', message);
  }
  return value as Record<string, unknown>;
}

function provider(value: string): ConnectorProvider {
  if (!CONNECTOR_PROVIDERS.includes(value as ConnectorProvider)) {
    throw new ConnectorError('conflict', 'Persistence returned an unknown connector provider.');
  }
  return value as ConnectorProvider;
}

function connectionStatus(value: string): ConnectorConnectionStatus {
  const mapped = value.replaceAll('_', '-') as ConnectorConnectionStatus;
  if (!CONNECTOR_CONNECTION_STATUSES.includes(mapped)) {
    throw new ConnectorError('conflict', 'Persistence returned an invalid connector connection status.');
  }
  return mapped;
}

function jobState(value: string): ConnectorJobState {
  const mapped = value === 'retry_wait' ? 'retry-scheduled'
    : value === 'reconciliation_required' ? 'reconciliation-required'
      : value === 'dead_letter' ? 'dead-letter' : value;
  if (!CONNECTOR_JOB_STATES.includes(mapped as ConnectorJobState)) {
    throw new ConnectorError('conflict', 'Persistence returned an invalid connector job state.');
  }
  return mapped as ConnectorJobState;
}

function receiptType(value: string): ConnectorReceiptType {
  if (!CONNECTOR_RECEIPT_TYPES.includes(value as ConnectorReceiptType)) {
    throw new ConnectorError('conflict', 'Persistence returned an invalid connector receipt type.');
  }
  return value as ConnectorReceiptType;
}

function errorCategory(value: string | null): ConnectorErrorCategory {
  if (!value) return 'none';
  const mapped = value.replaceAll('-', '_') as ConnectorErrorCategory;
  return CONNECTOR_ERROR_CATEGORIES.includes(mapped) ? mapped : 'internal_error';
}

function toConnection(row: ConnectionRow): ConnectorConnection {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: provider(row.provider),
    remoteAccountId: row.provider_account_key_hash ?? 'not-yet-bound',
    remoteAccountLabel: row.display_label,
    grantedScopes: [...row.granted_scopes],
    status: connectionStatus(row.status),
    ...(row.last_probe_at ? { tokenUpdatedAt: row.last_probe_at } : {}),
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.disconnected_at ? { disconnectedAt: row.disconnected_at } : {}),
  };
}

function toIntent(row: IntentRow, version: IntentVersionRow): ConnectorActionIntent {
  if (row.current_version !== version.version) {
    throw new ConnectorError('conflict', 'Persistence returned a mismatched connector intent version.');
  }
  if (!CONNECTOR_INTENT_STATUSES.includes(row.state as ConnectorActionIntent['status'])) {
    throw new ConnectorError('conflict', 'Persistence returned an invalid connector intent status.');
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: provider(row.provider),
    connectionId: row.connection_id,
    actionType: row.action_type,
    version: row.current_version,
    payloadReference: version.payload_ref,
    payloadHash: version.payload_hash,
    summary: row.summary,
    status: row.state as ConnectorActionIntent['status'],
    requestedByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const connectorPersistenceMappers = Object.freeze({
  connection: (row: ConnectionRow) => toConnection(row),
  intent: (row: IntentRow, version: IntentVersionRow) => toIntent(row, version),
  job: (row: JobRow) => toJob(row),
  receipt: (row: ReceiptRow) => toReceipt(row),
});

function toJob(row: JobRow): ConnectorJob {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    intentId: row.intent_id,
    intentVersion: row.intent_version,
    provider: provider(row.provider),
    actionType: row.action_type,
    payloadReference: row.payload_ref,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    state: jobState(row.state),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    fencingToken: Number(row.fencing_token),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function toReceipt(row: ReceiptRow): ConnectorReceipt {
  const metadata = row.redacted_metadata ?? {};
  const actor = typeof metadata.actorMembershipId === 'string' ? metadata.actorMembershipId : undefined;
  const detail = typeof metadata.detail === 'string' ? metadata.detail : undefined;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: provider(row.provider),
    ...(row.intent_id ? { intentId: row.intent_id } : {}),
    ...(row.job_id ? { jobId: row.job_id } : {}),
    ...(row.attempt_number ? { attemptNumber: row.attempt_number } : {}),
    type: receiptType(row.event_type),
    correlationId: row.correlation_id,
    ...(actor ? { actorMembershipId: actor } : {}),
    ...(row.provider_request_hash ? { requestHash: row.provider_request_hash } : {}),
    ...(row.remote_operation_id ? { providerReceiptId: row.remote_operation_id } : {}),
    ...(row.provider_status ? { providerStatus: row.provider_status } : {}),
    errorCategory: errorCategory(row.error_category),
    ...(detail ? { detail: detail.slice(0, 500) } : {}),
    occurredAt: row.occurred_at,
  };
}

async function currentVersion(
  supabase: SupabaseClient,
  scope: WorkspaceScope,
  intentId: string,
  expectedVersion?: number,
): Promise<IntentVersionRow> {
  let builder = supabase.from('connector_action_intent_versions')
    .select(VERSION_COLUMNS)
    .eq('workspace_id', scope.workspaceId)
    .eq('intent_id', intentId);
  if (expectedVersion !== undefined) builder = builder.eq('version', expectedVersion);
  const { data, error } = await builder.order('version', { ascending: false }).limit(1).maybeSingle();
  if (error) throw persistenceError('Failed to load connector intent version', error);
  if (!data) throw new ConnectorError('not-found', 'Connector intent version was not found.');
  return data as unknown as IntentVersionRow;
}

function intentEnvelope(value: unknown): { intent: IntentRow; version?: IntentVersionRow; noOp?: boolean } {
  const envelope = object(value, 'Connector intent RPC returned an invalid envelope.');
  return {
    intent: object(envelope.intent, 'Connector intent RPC omitted intent.') as unknown as IntentRow,
    ...(envelope.version ? {
      version: object(envelope.version, 'Connector intent RPC returned an invalid version.') as unknown as IntentVersionRow,
    } : {}),
    ...(typeof envelope.noOp === 'boolean' ? { noOp: envelope.noOp } : {}),
  };
}

export function supabaseConnectorRepository(
  supabase: SupabaseClient,
  definitions: readonly ConnectorDefinition[] = [],
): ConnectorRepository {
  return {
    async listDefinitions(scope) {
      liveScope(scope);
      return definitions.map((definition) => ({
        ...definition,
        capabilities: [...definition.capabilities],
        productionRequirements: [...definition.productionRequirements],
      }));
    },

    async listConnections(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      let builder = supabase.from('connector_connections').select(CONNECTION_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (query.provider) builder = builder.eq('provider', query.provider);
      const { data, error } = await builder.order('updated_at', { ascending: false }).limit(query.limit);
      if (error) throw persistenceError('Failed to list connector connections', error);
      return ((data ?? []) as unknown as ConnectionRow[]).map(toConnection);
    },

    async getConnection(untrustedScope, id) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await supabase.from('connector_connections').select(CONNECTION_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', id).maybeSingle();
      if (error) throw persistenceError('Failed to load connector connection', error);
      return data ? toConnection(data as unknown as ConnectionRow) : undefined;
    },

    async disconnectConnection(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (scope.role !== 'owner' || input.actorMembershipId !== scope.membershipId) {
        throw new ConnectorError('forbidden', 'Workspace owner access is required.');
      }
      const { data, error } = await supabase.rpc('request_connector_disconnect', {
        target_connection_id: input.connectionId,
        target_correlation_id: input.correlationId,
      });
      if (error) throw persistenceError('Failed to disconnect connector', error);
      const envelope = object(data, 'Connector disconnect returned an invalid envelope.');
      return {
        connection: toConnection(object(envelope.connection, 'Connector disconnect omitted connection.') as unknown as ConnectionRow),
        receipt: toReceipt(object(envelope.receipt, 'Connector disconnect omitted receipt.') as unknown as ReceiptRow),
        noOp: envelope.noOp === true,
      };
    },

    async listIntents(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      let builder = supabase.from('connector_action_intents').select(INTENT_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (query.provider) builder = builder.eq('provider', query.provider);
      const { data, error } = await builder.order('updated_at', { ascending: false }).limit(query.limit);
      if (error) throw persistenceError('Failed to list connector intents', error);
      const rows = (data ?? []) as unknown as IntentRow[];
      return Promise.all(rows.map(async (row) => toIntent(row, await currentVersion(supabase, scope, row.id, row.current_version))));
    },

    async createIntent(untrustedScope, input) {
      liveScope(untrustedScope);
      if (!input.connectionId || !input.policyId || !input.policyVersion || !input.correlationId) {
        throw new ConnectorError('invalid-input', 'Live intent requires connection, payload, policy, and correlation references.');
      }
      const { data, error } = await supabase.rpc('create_connector_action_intent', {
        target_connection_id: input.connectionId,
        target_action_type: input.actionType,
        target_summary: input.summary,
        target_payload_ref: input.payloadReference,
        target_payload_hash: input.payloadHash,
        target_policy_id: input.policyId,
        target_policy_version: input.policyVersion,
        target_compliance_snapshot: input.complianceSnapshot ?? {},
        target_correlation_id: input.correlationId,
      });
      if (error) throw persistenceError('Failed to create connector intent', error);
      const envelope = intentEnvelope(data);
      if (!envelope.version) throw new ConnectorError('conflict', 'Connector intent RPC omitted its version.');
      return toIntent(envelope.intent, envelope.version);
    },

    async editIntent(untrustedScope, input) {
      liveScope(untrustedScope);
      if (!input.policyId || !input.policyVersion || !input.correlationId) {
        throw new ConnectorError('invalid-input', 'Live revision requires payload, policy, and correlation references.');
      }
      const { data, error } = await supabase.rpc('revise_connector_action_intent', {
        target_intent_id: input.intentId,
        target_expected_version: input.expectedVersion,
        target_summary: input.summary,
        target_payload_ref: input.payloadReference,
        target_payload_hash: input.payloadHash,
        target_policy_id: input.policyId,
        target_policy_version: input.policyVersion,
        target_compliance_snapshot: input.complianceSnapshot ?? {},
        target_correlation_id: input.correlationId,
      });
      if (error) throw persistenceError('Failed to revise connector intent', error);
      const envelope = intentEnvelope(data);
      if (!envelope.version) throw new ConnectorError('conflict', 'Connector revision RPC omitted its version.');
      return toIntent(envelope.intent, envelope.version);
    },

    async approveIntent(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (scope.role !== 'owner' || input.actorMembershipId !== scope.membershipId) {
        throw new ConnectorError('forbidden', 'Workspace owner approval is required.');
      }
      const version = await currentVersion(supabase, scope, input.intentId, input.expectedVersion);
      const { data, error } = await supabase.rpc('approve_and_enqueue_connector_action', {
        target_intent_id: input.intentId,
        target_expected_version: input.expectedVersion,
        target_payload_hash: version.payload_hash,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_scheduled_at: input.decidedAt,
        target_max_attempts: 5,
      });
      if (error) throw persistenceError('Failed to approve connector intent', error);
      const envelope = object(data, 'Connector approval returned an invalid envelope.');
      return {
        intent: toIntent(
          object(envelope.intent, 'Connector approval omitted intent.') as unknown as IntentRow,
          version,
        ),
        job: toJob(object(envelope.job, 'Connector approval omitted job.') as unknown as JobRow),
        receipt: toReceipt(object(envelope.receipt, 'Connector approval omitted receipt.') as unknown as ReceiptRow),
        noOp: envelope.noOp === true,
      };
    },

    async rejectIntent(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (scope.role !== 'owner' || input.actorMembershipId !== scope.membershipId) {
        throw new ConnectorError('forbidden', 'Workspace owner approval is required.');
      }
      const version = await currentVersion(supabase, scope, input.intentId, input.expectedVersion);
      const { data, error } = await supabase.rpc('reject_connector_action_intent', {
        target_intent_id: input.intentId,
        target_expected_version: input.expectedVersion,
        target_payload_hash: version.payload_hash,
        target_reason: 'Rejected by workspace owner.',
        target_correlation_id: input.correlationId,
      });
      if (error) throw persistenceError('Failed to reject connector intent', error);
      return toIntent(
        object(object(data, 'Connector rejection returned an invalid envelope.').intent, 'Connector rejection omitted intent.') as unknown as IntentRow,
        version,
      );
    },

    async listJobs(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      let builder = supabase.from('connector_jobs').select(JOB_COLUMNS).eq('workspace_id', scope.workspaceId);
      if (query.provider) builder = builder.eq('provider', query.provider);
      if (query.state && query.state !== 'all') {
        const dbState = query.state === 'retry-scheduled' ? 'retry_wait'
          : query.state === 'reconciliation-required' ? 'reconciliation_required'
            : query.state === 'dead-letter' ? 'dead_letter' : query.state;
        builder = builder.eq('state', dbState);
      }
      const { data, error } = await builder.order('updated_at', { ascending: false }).limit(query.limit);
      if (error) throw persistenceError('Failed to list connector jobs', error);
      return ((data ?? []) as unknown as JobRow[]).map(toJob);
    },

    async getJob(untrustedScope, id) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await supabase.from('connector_jobs').select(JOB_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', id).maybeSingle();
      if (error) throw persistenceError('Failed to load connector job', error);
      return data ? toJob(data as unknown as JobRow) : undefined;
    },

    async retryJob(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (scope.role !== 'owner' || input.actorMembershipId !== scope.membershipId) {
        throw new ConnectorError('forbidden', 'Workspace owner access is required.');
      }
      const { data, error } = await supabase.rpc('retry_connector_job', {
        target_job_id: input.jobId,
        target_correlation_id: randomUUID(),
        target_scheduled_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to retry connector job', error);
      return toJob(object(object(data, 'Connector retry returned an invalid envelope.').job, 'Connector retry omitted job.') as unknown as JobRow);
    },

    async cancelJob(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (scope.role !== 'owner' || input.actorMembershipId !== scope.membershipId) {
        throw new ConnectorError('forbidden', 'Workspace owner access is required.');
      }
      const { data, error } = await supabase.rpc('cancel_connector_job', {
        target_job_id: input.jobId,
        target_correlation_id: randomUUID(),
        target_cancelled_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to cancel connector job', error);
      return toJob(object(object(data, 'Connector cancellation returned an invalid envelope.').job, 'Connector cancellation omitted job.') as unknown as JobRow);
    },

    async listReceipts(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      let builder = supabase.from('connector_receipt_events').select(RECEIPT_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (query.provider) builder = builder.eq('provider', query.provider);
      if (query.jobId) builder = builder.eq('job_id', query.jobId);
      if (query.intentId) builder = builder.eq('intent_id', query.intentId);
      const { data, error } = await builder.order('occurred_at', { ascending: false }).limit(query.limit);
      if (error) throw persistenceError('Failed to list connector receipts', error);
      return ((data ?? []) as unknown as ReceiptRow[]).map(toReceipt);
    },

    async leaseJobs() { throw new ConnectorError('forbidden', 'Job claims require the server-only worker repository.'); },
    async beginAttempt() { throw new ConnectorError('forbidden', 'Job attempts require the server-only worker repository.'); },
    async completeJob() { throw new ConnectorError('forbidden', 'Job transitions require the server-only worker repository.'); },
    async deferJob() { throw new ConnectorError('forbidden', 'Job transitions require the server-only worker repository.'); },
    async appendReceipt() { throw new ConnectorError('forbidden', 'Receipt appends require a governed database RPC.'); },
  };
}
