import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}
function integer(value: unknown, field: string, min = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new ConnectorError('conflict', `${field} is invalid.`);
  return parsed;
}
function envelope(value: unknown): ConnectorSecretEnvelope & { readonly secretVersion: number; readonly expiresAt?: string } {
  const row = object(value, 'Google encrypted authority is invalid.');
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'), secretVersion: integer(row.secretVersion ?? row.cursorVersion, 'secretVersion', 1),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
  };
}

export interface GoogleGmailWakeupJob {
  readonly id: string; readonly workspaceId: string; readonly connectionId: string;
  readonly state: string; readonly attemptCount: number; readonly maxAttempts: number;
  readonly fencingToken: number; readonly correlationId: string;
  readonly jobKind: 'history-sync' | 'watch-renewal';
}
export interface GoogleGmailWakeupAuthority {
  readonly job: GoogleGmailWakeupJob & { readonly wakeGeneration: number; readonly claimedGeneration: number };
  readonly connectionEmail: string; readonly accessState: 'live' | 'refresh-required';
  readonly grantedScopes: readonly string[];
  readonly access: ReturnType<typeof envelope>; readonly refresh?: ReturnType<typeof envelope>;
  readonly cursor?: { readonly version: number; readonly envelope: ConnectorSecretEnvelope };
  readonly watch: { readonly resourceVersion: number; readonly bindingVersion: number;
    readonly expiresAt: string; readonly subscriptionHash: string };
}

function job(value: unknown): GoogleGmailWakeupJob {
  const row = object(value, 'Google Gmail wake-up job is invalid.');
  return {
    id: text(row.id ?? row.jobId, 'jobId'), workspaceId: text(row.workspace_id ?? row.workspaceId, 'workspaceId'),
    connectionId: text(row.connection_id ?? row.connectionId, 'connectionId'), state: text(row.state, 'state'),
    attemptCount: integer(row.attempt_count ?? row.attemptCount, 'attemptCount'),
    maxAttempts: integer(row.max_attempts ?? row.maxAttempts, 'maxAttempts', 1),
    fencingToken: integer(row.fencing_token ?? row.fencingToken, 'fencingToken'),
    correlationId: text(row.correlation_id ?? row.correlationId, 'correlationId'),
    jobKind: (row.job_kind ?? row.jobKind) === 'watch-renewal' ? 'watch-renewal' : 'history-sync',
  };
}

function problem(message: string, error: { code?: string }): never {
  if (error.code === '42501') throw new ConnectorError('lease-lost', message);
  if (error.code === 'P0002') throw new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', message);
  if (['22023', '23514'].includes(error.code ?? '')) throw new ConnectorError('invalid-input', message);
  throw new Error(`${message}: persistence failed.`);
}

export function supabaseGoogleGmailWakeupRepository(client: SupabaseClient) {
  return {
    async schedule(input: { now: string; horizonSeconds: number; limit: number }) {
      const { data, error } = await client.rpc('schedule_due_google_gmail_watch_renewals', {
        target_now: input.now, target_horizon_seconds: input.horizonSeconds, target_limit: input.limit,
      });
      if (error) problem('Failed to schedule Google Gmail watch renewals', error);
      const result = object(data, 'Google Gmail watch renewal schedule is invalid.');
      return integer(result.count, 'count');
    },
    async claim(input: { workerId: string; batchSize: number; leaseSeconds: number; now: string }) {
      const { data, error } = await client.rpc('claim_google_gmail_history_wakeup_jobs', {
        target_worker_id: input.workerId, target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds, target_now: input.now,
      });
      if (error) problem('Failed to claim Google Gmail wake-ups', error);
      const result = object(data, 'Google Gmail wake-up claim is invalid.');
      if (!Array.isArray(result.jobs)) throw new ConnectorError('conflict', 'Google Gmail wake-up jobs are invalid.');
      return result.jobs.map(job);
    },
    async start(value: GoogleGmailWakeupJob, workerId: string, now: string) {
      const { data, error } = await client.rpc('start_google_gmail_history_wakeup_attempt', {
        target_job_id: value.id, target_worker_id: workerId,
        target_fencing_token: value.fencingToken, target_now: now,
      });
      if (error) problem('Failed to start Google Gmail wake-up', error);
      return job(object(data, 'Google Gmail wake-up start is invalid.').job);
    },
    async read(value: GoogleGmailWakeupJob, workerId: string, now: string): Promise<GoogleGmailWakeupAuthority> {
      const { data, error } = await client.rpc('read_google_gmail_history_wakeup_authority', {
        target_job_id: value.id, target_worker_id: workerId,
        target_fencing_token: value.fencingToken, target_now: now,
      });
      if (error) problem('Failed to read Google Gmail wake-up authority', error);
      const result = object(data, 'Google Gmail wake-up authority is invalid.');
      const { data: connection, error: connectionError } = await client.from('connector_connections')
        .select('granted_scopes').eq('id', value.connectionId).eq('workspace_id', value.workspaceId).single();
      if (connectionError || !connection || !Array.isArray(connection.granted_scopes)) {
        throw new ConnectorError('conflict', 'Google Gmail granted scopes are unavailable.');
      }
      const row = object(result.job, 'Google Gmail wake-up authority job is invalid.');
      const base = job({ ...row, state: 'executing', correlationId: value.correlationId });
      const access = envelope(result.accessEnvelope);
      const refresh = result.refreshEnvelope ? envelope(result.refreshEnvelope) : undefined;
      const cursorRow = result.cursorEnvelope ? object(result.cursorEnvelope, 'Google Gmail cursor is invalid.') : undefined;
      const watch = object(result.watch, 'Google Gmail watch authority is invalid.');
      if (!['live', 'refresh-required'].includes(String(result.accessState))) {
        throw new ConnectorError('conflict', 'Google Gmail access state is invalid.');
      }
      return {
        job: { ...base, wakeGeneration: integer(row.wakeGeneration, 'wakeGeneration', 1),
          claimedGeneration: integer(row.claimedGeneration, 'claimedGeneration', 1) },
        connectionEmail: text(result.connectionEmail, 'connectionEmail'),
        grantedScopes: connection.granted_scopes.filter((scope): scope is string => typeof scope === 'string'),
        accessState: result.accessState as 'live' | 'refresh-required', access,
        ...(refresh ? { refresh } : {}),
        ...(cursorRow ? { cursor: { version: integer(cursorRow.cursorVersion, 'cursorVersion', 1),
          envelope: envelope(cursorRow) } } : {}),
        watch: { resourceVersion: integer(watch.resourceVersion, 'resourceVersion', 1),
          bindingVersion: integer(watch.bindingVersion, 'bindingVersion', 1),
          expiresAt: text(watch.expiresAt, 'expiresAt'),
          subscriptionHash: text(watch.subscriptionHash, 'subscriptionHash') },
      };
    },
    async renew(input: { job: GoogleGmailWakeupJob; workerId: string; expectedWatchVersion: number;
      expectedBindingVersion: number; channelHash: string; resourceHash: string; expiresAt: string;
      endpointKeyHash: string; exactExternalUrlHash: string; subscriptionHash: string;
      oidcAudienceHash: string; occurredAt: string }) {
      const { error } = await client.rpc('renew_google_gmail_watch_from_wakeup', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken,
        target_expected_watch_resource_version: input.expectedWatchVersion,
        target_expected_binding_version: input.expectedBindingVersion,
        target_channel_key_hash: input.channelHash, target_resource_key_hash: input.resourceHash,
        target_expires_at: input.expiresAt, target_expected_endpoint_key_hash: input.endpointKeyHash,
        target_expected_exact_external_url_hash: input.exactExternalUrlHash,
        target_expected_subscription_hash: input.subscriptionHash,
        target_expected_oidc_audience_hash: input.oidcAudienceHash, target_occurred_at: input.occurredAt,
      });
      if (error) problem('Failed to renew Google Gmail watch', error);
    },
    async refresh(input: { job: GoogleGmailWakeupJob; workerId: string; expectedVersion: number;
      envelope: Record<string, unknown>; occurredAt: string }) {
      const { error } = await client.rpc('refresh_google_gmail_history_wakeup_access_token', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken,
        target_expected_access_secret_version: input.expectedVersion,
        target_access_envelope: input.envelope, target_occurred_at: input.occurredAt,
      });
      if (error) problem('Failed to refresh Google Gmail wake-up token', error);
    },
    async bindMetadata(input: { job: GoogleGmailWakeupJob; workerId: string; messageId: string;
      threadId: string; direction: string; counterpartEmail: string; counterpartKind: string;
      labels: readonly string[]; providerOccurredAt: string; resourceHash: string; occurredAt: string }) {
      const { data, error } = await client.rpc('bind_google_gmail_wakeup_metadata_resource', {
        target_wakeup_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_message_id: input.messageId,
        target_thread_id: input.threadId, target_direction: input.direction,
        target_normalized_counterpart_email: input.counterpartEmail,
        target_counterpart_kind: input.counterpartKind, target_labels: [...input.labels],
        target_provider_occurred_at: input.providerOccurredAt, target_resource_hash: input.resourceHash,
        target_occurred_at: input.occurredAt,
      });
      if (error) problem('Failed to bind Google Gmail wake-up metadata', error);
      const resource = object(object(data, 'Google Gmail metadata binding is invalid.').resource,
        'Google Gmail metadata resource is invalid.');
      return {
        linkState: text(resource.linkState, 'linkState'),
        ...(typeof resource.contactId === 'string' ? { contactId: resource.contactId } : {}),
      };
    },
    async recordIntelligence(input: { job: GoogleGmailWakeupJob; workerId: string; resourceHash: string;
      result: { state: string; policyVersion: string; contentHash: string; model?: string; intent: string;
        sentiment: string; urgency: string; summary?: string; unknowns: readonly string[] };
      occurredAt: string }) {
      const { error } = await client.rpc('record_omnix_inbound_response_intelligence', {
        target_wakeup_job_id: input.job.id,
        target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken,
        target_resource_hash: input.resourceHash,
        target_state: input.result.state,
        target_policy_version: input.result.policyVersion,
        target_content_hash: input.result.contentHash,
        target_model: input.result.model ?? null,
        target_intent: input.result.intent,
        target_sentiment: input.result.sentiment,
        target_urgency: input.result.urgency,
        target_summary: input.result.summary ?? null,
        target_unknowns: [...input.result.unknowns],
        target_occurred_at: input.occurredAt,
      });
      if (error) problem('Failed to record Gmail response intelligence', error);
    },
    async commit(input: { job: GoogleGmailWakeupJob; workerId: string; expectedVersion: number | null;
      cursorEnvelope: Record<string, unknown>; checkpointHash: string; hasMore: boolean;
      lastProviderEventAt?: string; occurredAt: string }) {
      const { data, error } = await client.rpc('commit_google_gmail_history_wakeup_checkpoint', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken,
        target_expected_cursor_version: input.expectedVersion,
        target_cursor_envelope: input.cursorEnvelope, target_checkpoint_hash: input.checkpointHash,
        target_has_more: input.hasMore, target_last_provider_event_at: input.lastProviderEventAt ?? null,
        target_occurred_at: input.occurredAt,
      });
      if (error) problem('Failed to commit Google Gmail wake-up cursor', error);
      return object(data, 'Google Gmail wake-up commit is invalid.').requeued === true;
    },
    async transition(input: { job: GoogleGmailWakeupJob; workerId: string;
      outcome: 'retry' | 'cursor_expired' | 'failed'; errorCategory: string;
      nextAttemptAt?: string; occurredAt: string }) {
      const { error } = await client.rpc('transition_google_gmail_history_wakeup_job', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_outcome: input.outcome,
        target_error_category: input.errorCategory, target_next_attempt_at: input.nextAttemptAt ?? null,
        target_occurred_at: input.occurredAt,
      });
      if (error) problem('Failed to transition Google Gmail wake-up', error);
    },
  };
}

export type GoogleGmailWakeupRepository = ReturnType<typeof supabaseGoogleGmailWakeupRepository>;
