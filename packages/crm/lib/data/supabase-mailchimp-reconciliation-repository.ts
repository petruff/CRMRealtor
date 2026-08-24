import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { MailchimpAudienceMember } from '../domain/mailchimp.ts';
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

function error(message: string, value: { code?: string }): Error {
  if (value.code === '42501') return new ConnectorError('forbidden', message);
  if (value.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(value.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(value.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function workerError(message: string, value: { code?: string }): Error {
  if (value.code === '42501') return new ConnectorError('lease-lost', message);
  return error(message, value);
}

function run(value: unknown): MailchimpReconciliationRun {
  const row = object(value, 'Mailchimp reconciliation run is invalid.');
  const state = text(row.state, 'state') as MailchimpReconciliationRun['state'];
  if (!['queued', 'leased', 'executing', 'retry_wait', 'succeeded', 'review', 'cancelled'].includes(state)) {
    throw new ConnectorError('conflict', 'Mailchimp reconciliation state is invalid.');
  }
  return {
    id: text(row.id, 'runId'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), bindingId: text(row.binding_id, 'bindingId'),
    mode: text(row.mode, 'mode') as 'baseline' | 'reconcile', state,
    snapshotHash: text(row.snapshot_hash, 'snapshotHash'), pageSize: integer(row.page_size, 'pageSize', 1),
    nextOffset: integer(row.next_offset, 'nextOffset'),
    ...(row.provider_total === null || row.provider_total === undefined
      ? {} : { providerTotal: integer(row.provider_total, 'providerTotal') }),
    pagesApplied: integer(row.pages_applied, 'pagesApplied'), itemsSeen: integer(row.items_seen, 'itemsSeen'),
    itemsApplied: integer(row.items_applied, 'itemsApplied'), itemsReviewed: integer(row.items_reviewed, 'itemsReviewed'),
    itemsBlocked: integer(row.items_blocked, 'itemsBlocked'), attemptCount: integer(row.attempt_count, 'attemptCount'),
    maxAttempts: integer(row.max_attempts, 'maxAttempts', 1), fencingToken: integer(row.fencing_token, 'fencingToken'),
    ...(typeof row.lease_owner === 'string' ? { leaseOwner: row.lease_owner } : {}),
    correlationId: text(row.correlation_id, 'correlationId'),
  };
}

function envelope(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'),
  };
}

export interface MailchimpReconciliationRun {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly mode: 'baseline' | 'reconcile';
  readonly state: 'queued' | 'leased' | 'executing' | 'retry_wait' | 'succeeded' | 'review' | 'cancelled';
  readonly snapshotHash: string;
  readonly pageSize: number;
  readonly nextOffset: number;
  readonly providerTotal?: number;
  readonly pagesApplied: number;
  readonly itemsSeen: number;
  readonly itemsApplied: number;
  readonly itemsReviewed: number;
  readonly itemsBlocked: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly fencingToken: number;
  readonly leaseOwner?: string;
  readonly correlationId: string;
}

export interface MailchimpReconciliationAuthority {
  readonly run: MailchimpReconciliationRun;
  readonly dataCenter: string;
  readonly audienceId: string;
  readonly mappingVersion: number;
  readonly secretVersion: number;
  readonly accessTokenEnvelope: ConnectorSecretEnvelope;
}

export interface MailchimpReconciliationMember extends MailchimpAudienceMember {
  readonly sourceHash: string;
}

export interface MailchimpReconciliationRepository {
  request(scope: WorkspaceScope, input: {
    readonly connectionId: string; readonly bindingId: string; readonly mode: 'baseline' | 'reconcile';
    readonly snapshotHash: string; readonly requestKeyHash: string; readonly pageSize: number;
    readonly correlationId: string; readonly requestedAt: string; readonly maxAttempts?: number;
  }): Promise<{ readonly run: MailchimpReconciliationRun; readonly noOp: boolean }>;
  list(scope: WorkspaceScope, connectionId: string, limit?: number): Promise<readonly MailchimpReconciliationRun[]>;
  claim(input: { readonly workerId: string; readonly batchSize: number; readonly leaseSeconds: number; readonly now: string }): Promise<readonly MailchimpReconciliationRun[]>;
  start(input: { readonly run: MailchimpReconciliationRun; readonly workerId: string; readonly now: string }): Promise<MailchimpReconciliationRun>;
  readAuthority(input: { readonly run: MailchimpReconciliationRun; readonly workerId: string; readonly now: string }): Promise<MailchimpReconciliationAuthority>;
  applyPage(input: {
    readonly run: MailchimpReconciliationRun; readonly workerId: string; readonly members: readonly MailchimpReconciliationMember[];
    readonly nextOffset: number; readonly providerTotal: number; readonly pageHash: string; readonly appliedAt: string;
  }): Promise<{ readonly run: MailchimpReconciliationRun; readonly finalPage: boolean; readonly noOp: boolean }>;
  complete(input: { readonly run: MailchimpReconciliationRun; readonly workerId: string; readonly providerRequestHash: string; readonly completedAt: string }): Promise<MailchimpReconciliationRun>;
  transition(input: { readonly run: MailchimpReconciliationRun; readonly workerId: string; readonly outcome: 'retry' | 'review'; readonly errorCategory: string; readonly retryAt?: string; readonly occurredAt: string }): Promise<MailchimpReconciliationRun>;
}

export function supabaseMailchimpReconciliationRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service: SupabaseClient;
}): MailchimpReconciliationRepository {
  return {
    async request(_scope, value) {
      const { data, error: problem } = await input.authenticated.rpc('request_mailchimp_reconciliation_run', {
        target_connection_id: value.connectionId, target_binding_id: value.bindingId, target_mode: value.mode,
        target_snapshot_hash: value.snapshotHash, target_request_key_hash: value.requestKeyHash,
        target_page_size: value.pageSize, target_correlation_id: value.correlationId,
        target_requested_at: value.requestedAt, target_max_attempts: value.maxAttempts ?? 5,
      });
      if (problem) {
        console.error(JSON.stringify({
          schemaVersion: 'connector-diagnostic.v1',
          provider: 'mailchimp',
          operation: 'request-reconciliation',
          databaseCode: problem.code ?? 'unknown',
        }));
        throw error('Failed to request Mailchimp reconciliation', problem);
      }
      const result = object(data, 'Mailchimp reconciliation request is invalid.');
      return { run: run(result.run), noOp: result.noOp === true };
    },
    async list(scope, connectionId, limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ConnectorError('invalid-input', 'Mailchimp reconciliation list limit is invalid.');
      const { data, error: problem } = await input.authenticated.from('mailchimp_reconciliation_runs')
        .select('*').eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId)
        .order('requested_at', { ascending: false }).limit(limit);
      if (problem) throw error('Failed to list Mailchimp reconciliations', problem);
      return ((data ?? []) as unknown[]).map(run);
    },
    async claim(value) {
      const { data, error: problem } = await input.service.rpc('claim_mailchimp_reconciliation_runs', {
        target_worker_id: value.workerId, target_batch_size: value.batchSize,
        target_lease_seconds: value.leaseSeconds, target_now: value.now,
      });
      if (problem) throw workerError('Failed to claim Mailchimp reconciliations', problem);
      return ((data ?? []) as unknown[]).map(run);
    },
    async start(value) {
      const { data, error: problem } = await input.service.rpc('start_mailchimp_reconciliation_run', {
        target_run_id: value.run.id, target_worker_id: value.workerId,
        target_fencing_token: value.run.fencingToken, target_started_at: value.now,
      });
      if (problem) throw workerError('Failed to start Mailchimp reconciliation', problem);
      return run(object(data, 'Mailchimp reconciliation start is invalid.').run);
    },
    async readAuthority(value) {
      const { data, error: problem } = await input.service.rpc('read_mailchimp_reconciliation_access_token', {
        target_run_id: value.run.id, target_worker_id: value.workerId,
        target_fencing_token: value.run.fencingToken, target_now: value.now,
      });
      if (problem) throw workerError('Failed to read Mailchimp reconciliation authority', problem);
      const result = object(data, 'Mailchimp reconciliation authority is invalid.');
      const redactedRun = object(result.run, 'Mailchimp reconciliation run authority is invalid.');
      const binding = object(result.binding, 'Mailchimp reconciliation binding is invalid.');
      const secret = object(result.secret, 'Mailchimp reconciliation token is invalid.');
      if (redactedRun.runId !== value.run.id
        || redactedRun.fencingToken !== value.run.fencingToken
        || binding.workspaceId !== value.run.workspaceId
        || binding.connectionId !== value.run.connectionId
        || binding.bindingId !== value.run.bindingId) {
        throw new ConnectorError('forbidden', 'Mailchimp reconciliation authority binding is invalid.');
      }
      return {
        run: value.run, dataCenter: text(binding.dataCenter, 'dataCenter'),
        audienceId: text(binding.audienceId, 'audienceId'), mappingVersion: integer(binding.mappingVersion, 'mappingVersion', 1),
        secretVersion: integer(secret.secretVersion, 'secretVersion', 1), accessTokenEnvelope: envelope(secret),
      };
    },
    async applyPage(value) {
      const members = value.members.map((member) => ({
        memberId: member.memberId, subscriberHash: member.subscriberHash,
        normalizedEmail: member.normalizedEmail, status: member.subscriptionStatus,
        sourceHash: text(member.sourceHash, 'sourceHash'),
      }));
      const { data, error: problem } = await input.service.rpc('apply_mailchimp_reconciliation_page', {
        target_run_id: value.run.id, target_worker_id: value.workerId,
        target_fencing_token: value.run.fencingToken, target_expected_offset: value.run.nextOffset,
        target_members: members, target_next_offset: value.nextOffset, target_provider_total: value.providerTotal,
        target_page_hash: value.pageHash, target_applied_at: value.appliedAt,
      });
      if (problem) throw workerError('Failed to apply Mailchimp reconciliation page', problem);
      const result = object(data, 'Mailchimp reconciliation page is invalid.');
      const enrichedMembers = value.members.map((member) => ({
        memberId: member.memberId,
        normalizedEmail: member.normalizedEmail,
        sourceHash: text(member.sourceHash, 'sourceHash'),
        ...(member.firstName ? { firstName: member.firstName } : {}),
        ...(member.lastName ? { lastName: member.lastName } : {}),
        ...(member.phone ? { phone: member.phone } : {}),
      }));
      const { error: enrichmentProblem } = await input.service.rpc('enrich_mailchimp_reconciliation_members', {
        target_run_id: value.run.id,
        target_worker_id: value.workerId,
        target_fencing_token: value.run.fencingToken,
        target_page_hash: value.pageHash,
        target_members: enrichedMembers,
        target_enriched_at: value.appliedAt,
      });
      if (enrichmentProblem) throw workerError('Failed to enrich Mailchimp reconciliation members', enrichmentProblem);
      return { run: run(result.run), finalPage: result.finalPage === true, noOp: result.noOp === true };
    },
    async complete(value) {
      const { data, error: problem } = await input.service.rpc('complete_mailchimp_reconciliation_run', {
        target_run_id: value.run.id, target_worker_id: value.workerId,
        target_fencing_token: value.run.fencingToken, target_provider_request_hash: value.providerRequestHash,
        target_completed_at: value.completedAt,
      });
      if (problem) throw workerError('Failed to complete Mailchimp reconciliation', problem);
      return run(object(data, 'Mailchimp reconciliation completion is invalid.').run);
    },
    async transition(value) {
      const { data, error: problem } = await input.service.rpc('transition_mailchimp_reconciliation_run', {
        target_run_id: value.run.id, target_worker_id: value.workerId,
        target_fencing_token: value.run.fencingToken, target_outcome: value.outcome,
        target_error_category: value.errorCategory, target_retry_at: value.retryAt ?? null,
        target_occurred_at: value.occurredAt,
      });
      if (problem) throw workerError('Failed to transition Mailchimp reconciliation', problem);
      return run(object(data, 'Mailchimp reconciliation transition is invalid.').run);
    },
  };
}
