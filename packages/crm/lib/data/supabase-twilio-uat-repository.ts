import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Twilio UAT ${field} is invalid.`);
  return value;
}
function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new ConnectorError('conflict', `Twilio UAT ${field} is invalid.`);
  return parsed;
}
function failure(error: { code?: string }, message: string): Error {
  if (['42501', '40001'].includes(error.code ?? '')) return new ConnectorError('lease-lost', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (error.code === '23505') return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}
function envelope(value: unknown): { version: number; envelope: ConnectorSecretEnvelope } {
  const row = record(value, 'Twilio UAT encrypted authority is invalid.');
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
function payloadEnvelope(value: unknown): { kind: string; version: number; hash: string; envelope: ConnectorSecretEnvelope } {
  const row = record(value, 'Twilio UAT payload authority is invalid.');
  return {
    kind: text(row.payloadKind, 'payloadKind'), version: integer(row.envelopeVersion, 'envelopeVersion', 1),
    hash: text(row.canonicalHash, 'canonicalHash'),
    envelope: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
      encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
      encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
      aadHash: text(row.aadHash, 'aadHash'),
    },
  };
}

export interface TwilioUatJob {
  id: string; workspaceId: string; connectionId: string; contactId: string; contactPointId: string;
  state: string; bodyHash: string; recipientPhoneHash: string; recipientTimezone?: string;
  policyVersion: number; fencingToken: number; attemptCount: number; maxAttempts: number;
  leaseOwner?: string; correlationId: string;
}
function job(value: unknown): TwilioUatJob {
  const row = record(value, 'Twilio UAT job is invalid.');
  return {
    id: text(row.id, 'jobId'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), contactId: text(row.contact_id, 'contactId'),
    contactPointId: text(row.contact_point_id, 'contactPointId'), state: text(row.state, 'state'),
    bodyHash: text(row.body_hash, 'bodyHash'), recipientPhoneHash: text(row.recipient_phone_hash, 'recipientPhoneHash'),
    ...(typeof row.recipient_timezone === 'string' ? { recipientTimezone: row.recipient_timezone } : {}),
    policyVersion: integer(row.texting_policy_version, 'policyVersion', 1),
    fencingToken: integer(row.fencing_token, 'fencingToken'), attemptCount: integer(row.attempt_count, 'attemptCount'),
    maxAttempts: integer(row.max_attempts, 'maxAttempts', 1),
    ...(typeof row.lease_owner === 'string' ? { leaseOwner: row.lease_owner } : {}),
    correlationId: text(row.correlation_id, 'correlationId'),
  };
}

export interface TwilioUatAuthority {
  job: TwilioUatJob; accountSidHash: string; apiKeySidHash: string; messagingServiceSidHash: string;
  providerAuthorityVersion: number; providerAuthorityEnvelope: ConnectorSecretEnvelope;
  apiCredentialVersion: number; apiCredentialEnvelope: ConnectorSecretEnvelope;
  mode: 'send' | 'lookup-only'; providerMessageSid?: string; providerMessageSidHash?: string;
  evidenceComplete: boolean;
  payloadKind?: string; payloadVersion?: number; payloadHash?: string; payloadEnvelope?: ConnectorSecretEnvelope;
}

export interface TwilioUatRepository {
  claim(input: { workerId: string; batchSize: number; leaseSeconds: number; now: string }): Promise<readonly TwilioUatJob[]>;
  start(input: { job: TwilioUatJob; workerId: string; now: string }): Promise<TwilioUatJob>;
  read(input: { job: TwilioUatJob; workerId: string; now: string }): Promise<TwilioUatAuthority>;
  bind(input: { job: TwilioUatJob; workerId: string; messageSid: string; requestHash: string; now: string }): Promise<void>;
  transition(input: { job: TwilioUatJob; workerId: string; outcome: 'delivered' | 'retry' | 'failed'; finalStatus?: string; evidenceHash?: string; errorCategory?: string; nextAttemptAt?: string; now: string }): Promise<TwilioUatJob>;
}

export function supabaseTwilioUatRepository(client: SupabaseClient): TwilioUatRepository {
  return {
    async claim(input) {
      const { data, error } = await client.rpc('claim_twilio_real_number_uat_jobs', {
        target_worker_id: input.workerId, target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds, target_now: input.now,
      });
      if (error) throw failure(error, 'Twilio UAT claim failed');
      const result = record(data, 'Twilio UAT claim is invalid.');
      if (!Array.isArray(result.jobs)) throw new ConnectorError('conflict', 'Twilio UAT jobs are invalid.');
      return result.jobs.map(job);
    },
    async start(input) {
      const { data, error } = await client.rpc('start_twilio_real_number_uat_attempt', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_started_at: input.now,
      });
      if (error) throw failure(error, 'Twilio UAT start failed');
      return job(record(data, 'Twilio UAT start is invalid.').job);
    },
    async read(input) {
      const { data, error } = await client.rpc('read_twilio_real_number_uat_authority', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_now: input.now,
      });
      if (error) throw failure(error, 'Twilio UAT authority read failed');
      const result = record(data, 'Twilio UAT authority is invalid.');
      const parsedJob = job(result.job);
      const authority = record(result.authority, 'Twilio UAT provider authority is invalid.');
      const provider = envelope(result.providerAuthority);
      const api = envelope(result.apiCredential);
      const mode = result.executionMode;
      if (mode !== 'send' && mode !== 'lookup-only') throw new ConnectorError('conflict', 'Twilio UAT execution mode is invalid.');
      const payload = mode === 'send' ? payloadEnvelope(result.payloadEnvelope) : undefined;
      const binding = mode === 'lookup-only' ? record(result.providerMessageBinding, 'Twilio UAT SID binding is invalid.') : undefined;
      if (typeof result.evidenceComplete !== 'boolean') {
        throw new ConnectorError('conflict', 'Twilio UAT evidence state is invalid.');
      }
      return {
        job: parsedJob, accountSidHash: text(authority.account_sid_hash, 'accountSidHash'),
        apiKeySidHash: text(authority.api_key_sid_hash, 'apiKeySidHash'),
        messagingServiceSidHash: text(authority.messaging_service_sid_hash, 'messagingServiceSidHash'),
        providerAuthorityVersion: provider.version, providerAuthorityEnvelope: provider.envelope,
        apiCredentialVersion: api.version, apiCredentialEnvelope: api.envelope, mode,
        evidenceComplete: result.evidenceComplete,
        ...(payload ? { payloadKind: payload.kind, payloadVersion: payload.version, payloadHash: payload.hash, payloadEnvelope: payload.envelope } : {}),
        ...(binding ? { providerMessageSid: text(binding.providerMessageSid, 'providerMessageSid'), providerMessageSidHash: text(binding.providerMessageSidHash, 'providerMessageSidHash') } : {}),
      };
    },
    async bind(input) {
      const { error } = await client.rpc('bind_twilio_real_number_uat_provider_message', {
        target_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_provider_message_sid: input.messageSid,
        target_provider_request_hash: input.requestHash, target_occurred_at: input.now,
      });
      if (error) throw failure(error, 'Twilio UAT provider binding failed');
    },
    async transition(input) {
      const { data, error } = await client.rpc('transition_twilio_real_number_uat_job', {
        target_job_id: input.job.id, target_worker_id: input.workerId, target_fencing_token: input.job.fencingToken,
        target_outcome: input.outcome, target_provider_final_status: input.finalStatus ?? null,
        target_provider_evidence_hash: input.evidenceHash ?? null, target_error_category: input.errorCategory ?? null,
        target_next_attempt_at: input.nextAttemptAt ?? null, target_now: input.now,
      });
      if (error) throw failure(error, 'Twilio UAT transition failed');
      return job(record(data, 'Twilio UAT transition is invalid.').job);
    },
  };
}
