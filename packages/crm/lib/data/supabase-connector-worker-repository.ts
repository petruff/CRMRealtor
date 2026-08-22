import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, type ConnectorJob } from '../domain/connector.ts';
import { connectorPersistenceMappers } from './supabase-connector-repository.ts';

export interface ConnectorWorkerTransition {
  readonly jobId: string;
  readonly workerId: string;
  readonly fencingToken: number;
  readonly state: 'succeeded' | 'retry_wait' | 'reconciliation_required' | 'failed' | 'dead_letter';
  readonly receiptType: 'provider.accepted' | 'provider.failed' | 'provider.unknown' | 'reconciliation.resolved';
  readonly errorCategory?: string;
  readonly providerRequestHash?: string;
  readonly remoteOperationId?: string;
  readonly providerStatus?: string;
  readonly reconciliationResult?: string;
  readonly scheduledAt?: string;
  readonly transitionedAt: string;
}

export interface ConnectorWorkerRepository {
  claimJobs(input: { workerId: string; batchSize: number; leaseSeconds: number; now: string }): Promise<readonly ConnectorJob[]>;
  claimReconciliationJobs(input: { workerId: string; batchSize: number; leaseSeconds: number; now: string }): Promise<readonly ConnectorJob[]>;
  startAttempt(input: { jobId: string; workerId: string; fencingToken: number; startedAt: string }): Promise<ConnectorJob>;
  transition(input: ConnectorWorkerTransition): Promise<ConnectorJob>;
  sweepExpired(input: { batchSize: number; now: string }): Promise<readonly ConnectorJob[]>;
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

function envelopeJob(value: unknown, message: string): ConnectorJob {
  const envelope = object(value, message);
  return connectorPersistenceMappers.job(object(envelope.job, `${message} Job is missing.`) as never);
}

export function supabaseConnectorWorkerRepository(
  supabase: SupabaseClient,
): ConnectorWorkerRepository {
  return {
    async claimJobs(input) {
      const { data, error } = await supabase.rpc('claim_connector_jobs', {
        target_worker_id: input.workerId,
        target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to claim connector jobs', error);
      return ((data ?? []) as unknown[]).map((row) => connectorPersistenceMappers.job(row as never));
    },

    async claimReconciliationJobs(input) {
      const { data, error } = await supabase.rpc('claim_connector_reconciliation_jobs', {
        target_worker_id: input.workerId,
        target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to claim connector reconciliation jobs', error);
      return ((data ?? []) as unknown[]).map((row) => connectorPersistenceMappers.job(row as never));
    },

    async startAttempt(input) {
      const { data, error } = await supabase.rpc('start_connector_job_attempt', {
        target_job_id: input.jobId,
        target_worker_id: input.workerId,
        target_fencing_token: input.fencingToken,
        target_started_at: input.startedAt,
      });
      if (error) throw persistenceError('Failed to start connector job attempt', error);
      return envelopeJob(data, 'Connector attempt returned an invalid envelope.');
    },

    async transition(input) {
      const { data, error } = await supabase.rpc('transition_connector_job', {
        target_job_id: input.jobId,
        target_worker_id: input.workerId,
        target_fencing_token: input.fencingToken,
        target_state: input.state,
        target_receipt_event_type: input.receiptType,
        target_error_category: input.errorCategory ?? null,
        target_provider_request_hash: input.providerRequestHash ?? null,
        target_remote_operation_id: input.remoteOperationId ?? null,
        target_provider_status: input.providerStatus ?? null,
        target_reconciliation_result: input.reconciliationResult ?? null,
        target_scheduled_at: input.scheduledAt ?? null,
        target_redacted_metadata: {},
        target_transitioned_at: input.transitionedAt,
      });
      if (error) throw persistenceError('Failed to transition connector job', error);
      return envelopeJob(data, 'Connector transition returned an invalid envelope.');
    },

    async sweepExpired(input) {
      const { data, error } = await supabase.rpc('sweep_expired_connector_job_leases', {
        target_batch_size: input.batchSize,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to sweep expired connector leases', error);
      return ((data ?? []) as unknown[]).map((row) => connectorPersistenceMappers.job(row as never));
    },
  };
}
