import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return value;
}
function integer(value: unknown, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return Number(value);
}
function failure(error: { code?: string }, message: string): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('lease-lost', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

export interface MetaNormalizationJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly eventId: string;
  readonly fencingToken: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}

function job(value: unknown): MetaNormalizationJob {
  const row = object(value, 'Meta normalization job is invalid.');
  return {
    id: text(row.id, 'jobId'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), eventId: text(row.event_id, 'eventId'),
    fencingToken: integer(row.fencing_token, 'fencingToken'),
    attemptCount: integer(row.attempt_count, 'attemptCount', true),
    maxAttempts: integer(row.max_attempts, 'maxAttempts'),
  };
}

function envelope(row: Record<string, unknown>): { value: ConnectorSecretEnvelope; version: number; canonicalHash: string } {
  return {
    version: integer(row.envelopeVersion, 'envelopeVersion'), canonicalHash: text(row.canonicalHash, 'canonicalHash'),
    value: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
      encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
      encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
      aadHash: text(row.aadHash, 'aadHash'),
    },
  };
}

export function supabaseMetaNormalizationRepository(client: SupabaseClient) {
  return {
    async claim(input: { workerId: string; batchSize: number; leaseSeconds: number; now: string }) {
      const { data, error } = await client.rpc('claim_meta_normalization_jobs', {
        target_worker_id: input.workerId, target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds, target_now: input.now,
      });
      if (error) throw failure(error, 'Meta normalization jobs could not be claimed');
      const row = object(data, 'Meta normalization claim is invalid.');
      return (Array.isArray(row.jobs) ? row.jobs : []).map(job);
    },
    async start(input: { job: MetaNormalizationJob; workerId: string; now: string }) {
      const { data, error } = await client.rpc('start_meta_normalization_attempt', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_started_at: input.now,
      });
      if (error) throw failure(error, 'Meta normalization attempt could not start');
      return job(object(data, 'Meta normalization start is invalid.').job);
    },
    async read(input: { job: MetaNormalizationJob; workerId: string; now: string }) {
      const { data, error } = await client.rpc('read_meta_normalization_authority', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_now: input.now,
      });
      if (error) throw failure(error, 'Meta normalization authority is unavailable');
      const row = object(data, 'Meta normalization authority is invalid.');
      const event = object(row.event, 'Meta normalization event is invalid.');
      return { eventContentHash: text(event.content_hash, 'contentHash'), payload: envelope(object(row.payloadEnvelope, 'Meta content envelope is invalid.')) };
    },
    async apply(input: { job: MetaNormalizationJob; workerId: string; evidenceHash: string; occurredAt: string }) {
      const { data, error } = await client.rpc('apply_meta_normalized_enquiry', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken,
        // Free-text message content is never treated as authoritative contact identity.
        target_normalized_email: null, target_normalized_phone: null,
        target_identity_evidence_hash: input.evidenceHash, target_occurred_at: input.occurredAt,
      });
      if (error) throw failure(error, 'Meta enquiry could not be normalized');
      const row = object(data, 'Meta normalization result is invalid.');
      return text(row.outcome, 'normalization outcome');
    },
    async transition(input: {
      job: MetaNormalizationJob; workerId: string; outcome: 'retry' | 'failed';
      errorCategory: string; retryAt?: string; occurredAt: string;
    }) {
      const { error } = await client.rpc('transition_meta_normalization_job', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_outcome: input.outcome,
        target_error_category: input.errorCategory, target_next_attempt_at: input.retryAt ?? null,
        target_now: input.occurredAt,
      });
      if (error) throw failure(error, 'Meta normalization transition failed');
    },
  };
}
export type SupabaseMetaNormalizationRepository = ReturnType<typeof supabaseMetaNormalizationRepository>;

