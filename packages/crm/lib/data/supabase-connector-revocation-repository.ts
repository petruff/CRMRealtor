import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ConnectorError,
  type ConnectorConnection,
  type ConnectorProvider,
} from '../domain/connector.ts';
import { connectorPersistenceMappers } from './supabase-connector-repository.ts';

export type ConnectorRevocationJobState =
  | 'queued'
  | 'leased'
  | 'executing'
  | 'retry-wait'
  | 'succeeded'
  | 'disconnected-unconfirmed';

export interface ConnectorRevocationJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly provider: ConnectorProvider;
  readonly state: ConnectorRevocationJobState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly scheduledAt: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly fencingToken: number;
  readonly correlationId: string;
  readonly connection: ConnectorConnection;
}

export interface ConnectorRevocationSecretEnvelope {
  readonly secretId: string;
  readonly secretType: string;
  readonly secretVersion: number;
  readonly ciphertext: string;
  readonly nonce: string;
  readonly authTag: string;
  readonly wrappedDek: string;
  readonly wrapNonce: string;
  readonly wrapAuthTag: string;
  readonly kekVersion: string;
  readonly aadHash: string;
  readonly expiresAt?: string;
}

export interface ConnectorRevocationTransition {
  readonly jobId: string;
  readonly workerId: string;
  readonly fencingToken: number;
  readonly outcome: 'confirmed' | 'retry' | 'unknown' | 'terminal';
  readonly errorCategory?: string;
  readonly nextAttemptAt?: string;
  readonly evidence: Readonly<{
    confirmationKind?: 'provider-confirmed';
    providerRequestHash?: string;
    providerStatus?: string;
    reasonCode?: string;
  }>;
  readonly transitionedAt: string;
}

export interface ConnectorRevocationRepository {
  claim(input: {
    readonly workerId: string;
    readonly batchSize: number;
    readonly leaseSeconds: number;
    readonly now: string;
  }): Promise<readonly ConnectorRevocationJob[]>;
  start(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly fencingToken: number;
    readonly startedAt: string;
  }): Promise<ConnectorRevocationJob>;
  transition(input: ConnectorRevocationTransition): Promise<ConnectorRevocationJob>;
  readSecret(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly fencingToken: number;
    readonly secretType: string;
    readonly now: string;
  }): Promise<ConnectorRevocationSecretEnvelope>;
  readProviderAuthority?(input: {
    readonly jobId: string;
    readonly workerId: string;
    readonly fencingToken: number;
    readonly now: string;
  }): Promise<unknown>;
}

interface RevocationJobEnvelope {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly state: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly scheduledAt: string;
  readonly leaseOwner?: string | null;
  readonly leaseExpiresAt?: string | null;
  readonly fencingToken: number | string;
  readonly correlationId: string;
  readonly connection: unknown;
}

function persistenceError(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('lease-lost', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('conflict', message);
  }
  return value as Record<string, unknown>;
}

function mapState(value: string): ConnectorRevocationJobState {
  const state = value.replaceAll('_', '-') as ConnectorRevocationJobState;
  if (!['queued', 'leased', 'executing', 'retry-wait', 'succeeded', 'disconnected-unconfirmed'].includes(state)) {
    throw new ConnectorError('conflict', 'Persistence returned an invalid connector revocation state.');
  }
  return state;
}

function mapProvider(value: string): ConnectorProvider {
  if (!['contract-test', 'google', 'mailchimp', 'twilio', 'meta'].includes(value)) {
    throw new ConnectorError('conflict', 'Persistence returned an invalid connector provider.');
  }
  return value as ConnectorProvider;
}

function mapJob(value: unknown, message: string): ConnectorRevocationJob {
  const row = object(value, message) as unknown as RevocationJobEnvelope;
  const connection = connectorPersistenceMappers.connection(
    object(row.connection, `${message} Connection is missing.`) as never,
  );
  const provider = mapProvider(row.provider);
  if (connection.id !== row.connectionId || connection.workspaceId !== row.workspaceId || connection.provider !== provider) {
    throw new ConnectorError('conflict', 'Connector revocation authority does not match its connection.');
  }
  const fencingToken = Number(row.fencingToken);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 0) {
    throw new ConnectorError('conflict', 'Connector revocation returned an invalid fencing token.');
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    connectionId: row.connectionId,
    provider,
    state: mapState(row.state),
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    scheduledAt: row.scheduledAt,
    ...(row.leaseOwner ? { leaseOwner: row.leaseOwner } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAt: row.leaseExpiresAt } : {}),
    fencingToken,
    correlationId: row.correlationId,
    connection,
  };
}

function mapEnvelopeJob(value: unknown, message: string): ConnectorRevocationJob {
  const envelope = object(value, message);
  const job = object(envelope.revocationJob, `${message} Revocation job is missing.`);
  return mapJob({ ...job, connection: envelope.connection }, message);
}

function mapSecret(value: unknown): ConnectorRevocationSecretEnvelope {
  const row = object(value, 'Connector revocation secret returned an invalid envelope.');
  const required = [
    'secretId', 'secretType', 'ciphertext', 'nonce', 'authTag', 'wrappedDek',
    'wrapNonce', 'wrapAuthTag', 'kekVersion', 'aadHash',
  ] as const;
  for (const key of required) {
    if (typeof row[key] !== 'string' || !row[key]) {
      throw new ConnectorError('conflict', `Connector revocation secret omitted ${key}.`);
    }
  }
  if (!Number.isInteger(row.secretVersion) || Number(row.secretVersion) < 1) {
    throw new ConnectorError('conflict', 'Connector revocation secret version is invalid.');
  }
  return {
    secretId: row.secretId as string,
    secretType: row.secretType as string,
    secretVersion: Number(row.secretVersion),
    ciphertext: row.ciphertext as string,
    nonce: row.nonce as string,
    authTag: row.authTag as string,
    wrappedDek: row.wrappedDek as string,
    wrapNonce: row.wrapNonce as string,
    wrapAuthTag: row.wrapAuthTag as string,
    kekVersion: row.kekVersion as string,
    aadHash: row.aadHash as string,
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
  };
}

export function supabaseConnectorRevocationRepository(
  supabase: SupabaseClient,
): ConnectorRevocationRepository {
  return {
    async claim(input) {
      const { data, error } = await supabase.rpc('claim_connector_revocation_jobs', {
        target_worker_id: input.workerId,
        target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to claim connector revocations', error);
      const envelope = object(data, 'Connector revocation claim returned an invalid envelope.');
      if (!Array.isArray(envelope.jobs)) throw new ConnectorError('conflict', 'Connector revocation claim omitted jobs.');
      return envelope.jobs.map((job) => mapJob(job, 'Connector revocation claim returned an invalid job.'));
    },

    async start(input) {
      const { data, error } = await supabase.rpc('start_connector_revocation_attempt', {
        target_job_id: input.jobId,
        target_worker_id: input.workerId,
        target_fencing_token: input.fencingToken,
        target_started_at: input.startedAt,
      });
      if (error) throw persistenceError('Failed to start connector revocation', error);
      return mapEnvelopeJob(data, 'Connector revocation start returned an invalid envelope.');
    },

    async transition(input) {
      const { data, error } = await supabase.rpc('transition_connector_revocation_job', {
        target_job_id: input.jobId,
        target_worker_id: input.workerId,
        target_fencing_token: input.fencingToken,
        target_outcome: input.outcome,
        target_error_category: input.errorCategory ?? null,
        target_next_attempt_at: input.nextAttemptAt ?? null,
        target_evidence: input.evidence,
        target_now: input.transitionedAt,
      });
      if (error) throw persistenceError('Failed to transition connector revocation', error);
      return mapEnvelopeJob(data, 'Connector revocation transition returned an invalid envelope.');
    },

    async readSecret(input) {
      const { data, error } = await supabase.rpc('read_connector_revocation_secret_envelope', {
        target_job_id: input.jobId,
        target_worker_id: input.workerId,
        target_fencing_token: input.fencingToken,
        target_secret_type: input.secretType,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to read connector revocation secret', error);
      return mapSecret(data);
    },
    async readProviderAuthority(input) {
      const { data, error } = await supabase.rpc('read_meta_revocation_authority', {
        target_revocation_job_id: input.jobId,
        target_worker_id: input.workerId,
        target_fencing_token: input.fencingToken,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to read Meta revocation authority', error);
      return object(data, 'Meta revocation authority returned an invalid envelope.');
    },
  };
}
