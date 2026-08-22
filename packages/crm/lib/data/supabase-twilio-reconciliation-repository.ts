import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { TextingDeliveryState } from '../domain/texting.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new ConnectorError('conflict', `${field} is invalid.`);
  return parsed;
}

function workerError(message: string, value: { code?: string }): Error {
  if (['42501', '40001'].includes(value.code ?? '')) return new ConnectorError('lease-lost', message);
  if (value.code === 'P0002') return new ConnectorError('not-found', message);
  if (['22023', '23503', '23514'].includes(value.code ?? '')) return new ConnectorError('invalid-input', message);
  if (value.code === '23505') return new ConnectorError('conflict', message);
  return new Error(`${message}: persistence failed.`);
}

function secret(row: Record<string, unknown>): { readonly version: number; readonly envelope: ConnectorSecretEnvelope } {
  return {
    version: integer(row.secretVersion, 'secretVersion', 1),
    envelope: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
      encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
      encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
      aadHash: text(row.aadHash, 'aadHash'),
    },
  };
}

export interface TwilioReconciliationJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly messageId: string;
  readonly state: 'queued' | 'leased' | 'executing' | 'retry_wait' | 'succeeded' | 'failed';
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly fencingToken: number;
  readonly leaseOwner?: string;
  readonly correlationId: string;
}

function job(value: unknown): TwilioReconciliationJob {
  const row = object(value, 'Twilio reconciliation job is invalid.');
  const state = text(row.state, 'state') as TwilioReconciliationJob['state'];
  if (!['queued', 'leased', 'executing', 'retry_wait', 'succeeded', 'failed'].includes(state)) {
    throw new ConnectorError('conflict', 'Twilio reconciliation state is invalid.');
  }
  return {
    id: text(row.id, 'jobId'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), messageId: text(row.message_id, 'messageId'), state,
    attemptCount: integer(row.attempt_count, 'attemptCount'), maxAttempts: integer(row.max_attempts, 'maxAttempts', 1),
    fencingToken: integer(row.fencing_token, 'fencingToken'),
    ...(typeof row.lease_owner === 'string' ? { leaseOwner: row.lease_owner } : {}),
    correlationId: text(row.correlation_id, 'correlationId'),
  };
}

export interface TwilioReconciliationAuthority {
  readonly job: TwilioReconciliationJob;
  readonly accountSidHash: string;
  readonly apiKeySidHash: string;
  readonly messagingServiceSidHash: string;
  readonly providerMessageSid: string;
  readonly providerMessageSidHash: string;
  readonly providerAuthorityVersion: number;
  readonly providerAuthorityEnvelope: ConnectorSecretEnvelope;
  readonly apiCredentialVersion: number;
  readonly apiCredentialEnvelope: ConnectorSecretEnvelope;
}

export interface TwilioReconciliationRepository {
  schedule(input: { readonly now: string; readonly minimumAgeSeconds?: number; readonly limit?: number }): Promise<number>;
  claim(input: { readonly workerId: string; readonly batchSize: number; readonly leaseSeconds: number; readonly now: string }): Promise<readonly TwilioReconciliationJob[]>;
  start(input: { readonly job: TwilioReconciliationJob; readonly workerId: string; readonly now: string }): Promise<TwilioReconciliationJob>;
  readAuthority(input: { readonly job: TwilioReconciliationJob; readonly workerId: string; readonly now: string }): Promise<TwilioReconciliationAuthority>;
  transition(input: {
    readonly job: TwilioReconciliationJob; readonly workerId: string;
    readonly outcome: 'resolved' | 'retry' | 'unknown' | 'terminal';
    readonly providerStatus?: TextingDeliveryState; readonly errorCategory?: string;
    readonly retryAt?: string; readonly providerOccurredAt?: string; readonly now: string;
  }): Promise<TwilioReconciliationJob>;
}

export function supabaseTwilioReconciliationRepository(client: SupabaseClient): TwilioReconciliationRepository {
  return {
    async schedule(input) {
      const { data, error } = await client.rpc('schedule_due_twilio_reconciliation_jobs', {
        target_now: input.now, target_minimum_age_seconds: input.minimumAgeSeconds ?? 300,
        target_limit: input.limit ?? 25,
      });
      if (error) throw workerError('Failed to schedule Twilio reconciliation', error);
      return integer(object(data, 'Twilio reconciliation schedule is invalid.').count, 'count');
    },
    async claim(input) {
      const { data, error } = await client.rpc('claim_twilio_reconciliation_jobs', {
        target_worker_id: input.workerId, target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds, target_now: input.now,
      });
      if (error) throw workerError('Failed to claim Twilio reconciliation', error);
      const result = object(data, 'Twilio reconciliation claim is invalid.');
      if (!Array.isArray(result.jobs)) throw new ConnectorError('conflict', 'Twilio reconciliation jobs are invalid.');
      return result.jobs.map(job);
    },
    async start(input) {
      const { data, error } = await client.rpc('start_twilio_reconciliation_attempt', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_started_at: input.now,
      });
      if (error) throw workerError('Failed to start Twilio reconciliation', error);
      return job(object(data, 'Twilio reconciliation start is invalid.').job);
    },
    async readAuthority(input) {
      const { data, error } = await client.rpc('read_twilio_reconciliation_authority', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_now: input.now,
      });
      if (error) throw workerError('Failed to read Twilio reconciliation authority', error);
      const result = object(data, 'Twilio reconciliation authority is invalid.');
      const parsedJob = job(result.job);
      const connection = object(result.connection, 'Twilio reconciliation connection is invalid.');
      const authority = object(result.authority, 'Twilio reconciliation provider authority is invalid.');
      const provider = secret(object(result.providerAuthority, 'Twilio provider credential is invalid.'));
      const api = secret(object(result.apiCredential, 'Twilio API credential is invalid.'));
      if (parsedJob.id !== input.job.id || parsedJob.workspaceId !== input.job.workspaceId
        || parsedJob.connectionId !== input.job.connectionId || connection.id !== parsedJob.connectionId) {
        throw new ConnectorError('forbidden', 'Twilio reconciliation authority binding is invalid.');
      }
      return {
        job: parsedJob,
        accountSidHash: text(authority.account_sid_hash, 'accountSidHash'),
        apiKeySidHash: text(authority.api_key_sid_hash, 'apiKeySidHash'),
        messagingServiceSidHash: text(authority.messaging_service_sid_hash, 'messagingServiceSidHash'),
        providerMessageSid: text(result.providerMessageSid, 'providerMessageSid'),
        providerMessageSidHash: text(result.providerMessageSidHash, 'providerMessageSidHash'),
        providerAuthorityVersion: provider.version, providerAuthorityEnvelope: provider.envelope,
        apiCredentialVersion: api.version, apiCredentialEnvelope: api.envelope,
      };
    },
    async transition(input) {
      const { data, error } = await client.rpc('transition_twilio_reconciliation_job', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_outcome: input.outcome,
        target_provider_status: input.providerStatus ?? null, target_error_category: input.errorCategory ?? null,
        target_next_attempt_at: input.retryAt ?? null, target_provider_occurred_at: input.providerOccurredAt ?? null,
        target_now: input.now,
      });
      if (error) throw workerError('Failed to transition Twilio reconciliation', error);
      return job(object(data, 'Twilio reconciliation transition is invalid.').job);
    },
  };
}
