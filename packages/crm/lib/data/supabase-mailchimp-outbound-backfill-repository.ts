import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';
import type {
  MailchimpOutboundBackfillPage,
  MailchimpOutboundBackfillPreview,
  MailchimpOutboundBackfillRepository,
  MailchimpOutboundBackfillRun,
  MailchimpOutboundBackfillState,
} from './mailchimp-outbound-backfill-repository.ts';

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

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function workerError(message: string, error: { code?: string }): Error {
  if (['40001', '42501'].includes(error.code ?? '')) return new ConnectorError('lease-lost', message);
  return persistenceError(message, error);
}

const STATES: readonly MailchimpOutboundBackfillState[] = [
  'previewed', 'approved', 'leased', 'executing', 'retry_wait', 'succeeded', 'review', 'cancelled',
];

function run(value: unknown): MailchimpOutboundBackfillRun {
  const row = object(value, 'Mailchimp outbound run is invalid.');
  const state = text(row.state, 'state') as MailchimpOutboundBackfillState;
  const mode = text(row.mode, 'mode');
  const origin = text(row.request_origin, 'requestOrigin');
  if (!STATES.includes(state) || !['backfill', 'tag-reconcile'].includes(mode) || !['owner', 'scheduler'].includes(origin)) {
    throw new ConnectorError('conflict', 'Mailchimp outbound run enum is invalid.');
  }
  return {
    id: text(row.id, 'runId'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), bindingId: text(row.binding_id, 'bindingId'),
    mode: mode as 'backfill' | 'tag-reconcile', mappingVersion: integer(row.mapping_version, 'mappingVersion', 1),
    snapshotHash: text(row.snapshot_hash, 'snapshotHash'), eligibleCount: integer(row.eligible_count, 'eligibleCount'),
    pageSize: integer(row.page_size, 'pageSize', 1), state,
    nextOffset: integer(row.next_offset, 'nextOffset'), jobsEnqueued: integer(row.jobs_enqueued, 'jobsEnqueued'),
    attemptCount: integer(row.attempt_count, 'attemptCount'), maxAttempts: integer(row.max_attempts, 'maxAttempts', 1),
    correlationId: text(row.correlation_id, 'correlationId'), requestOrigin: origin as 'owner' | 'scheduler',
    ...(row.lease_owner ? { leaseOwner: text(row.lease_owner, 'leaseOwner') } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: text(row.lease_expires_at, 'leaseExpiresAt') } : {}),
    fencingToken: integer(row.fencing_token, 'fencingToken'), previewedAt: text(row.previewed_at, 'previewedAt'),
    ...(row.completed_at ? { completedAt: text(row.completed_at, 'completedAt') } : {}),
  };
}

function encrypted(item: { readonly itemIndex: number; readonly operationKey: string; readonly envelope: ConnectorSecretEnvelope }) {
  return {
    itemIndex: item.itemIndex, operationKey: item.operationKey,
    ciphertext: item.envelope.ciphertext, nonce: item.envelope.iv, authTag: item.envelope.tag,
    wrappedDek: item.envelope.encryptedDek, wrapNonce: item.envelope.encryptedDekIv,
    wrapAuthTag: item.envelope.encryptedDekTag, kekVersion: item.envelope.kekVersion,
    aadHash: item.envelope.aadHash,
  };
}

export function supabaseMailchimpOutboundBackfillRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service: SupabaseClient;
}): MailchimpOutboundBackfillRepository {
  return {
    async preview(scope, value) {
      const { data, error } = await input.authenticated.rpc('preview_mailchimp_outbound_backfill', {
        target_connection_id: value.connectionId, target_mode: value.mode,
        target_request_key_hash: value.requestKeyHash, target_page_size: value.pageSize,
        target_correlation_id: value.correlationId, target_previewed_at: value.previewedAt,
        target_max_attempts: value.maxAttempts,
      });
      if (error) throw persistenceError('Failed to preview Mailchimp outbound backfill', error);
      const envelope = object(data, 'Mailchimp outbound preview envelope is invalid.');
      const preview = object(envelope.preview, 'Mailchimp outbound preview is missing.');
      if (preview.workspaceId !== scope.workspaceId || preview.containsRawEmails !== false) {
        throw new ConnectorError('conflict', 'Mailchimp outbound preview authority is invalid.');
      }
      return {
        runId: text(preview.runId, 'runId'), workspaceId: text(preview.workspaceId, 'workspaceId'),
        connectionId: text(preview.connectionId, 'connectionId'), bindingId: text(preview.bindingId, 'bindingId'),
        mode: text(preview.mode, 'mode') as 'backfill' | 'tag-reconcile',
        mappingVersion: integer(preview.mappingVersion, 'mappingVersion', 1),
        snapshotHash: text(preview.snapshotHash, 'snapshotHash'),
        eligibleCount: integer(preview.eligibleCount, 'eligibleCount'),
        skippedUnlinkedCount: integer(preview.skippedUnlinkedCount, 'skippedUnlinkedCount'),
        skippedUnsubscribedCount: integer(preview.skippedUnsubscribedCount, 'skippedUnsubscribedCount'),
        pageSize: integer(preview.pageSize, 'pageSize', 1), containsRawEmails: false,
        noOp: envelope.noOp === true,
      } satisfies MailchimpOutboundBackfillPreview;
    },
    async approve(scope, value) {
      const { data, error } = await input.authenticated.rpc('approve_mailchimp_outbound_backfill', {
        target_run_id: value.runId, target_expected_snapshot_hash: value.snapshotHash,
        target_expected_mapping_version: value.mappingVersion, target_correlation_id: value.correlationId,
        target_approved_at: value.approvedAt,
      });
      if (error) throw persistenceError('Failed to approve Mailchimp outbound backfill', error);
      const envelope = object(data, 'Mailchimp outbound approval envelope is invalid.');
      const mapped = run(envelope.run);
      if (mapped.workspaceId !== scope.workspaceId) throw new ConnectorError('conflict', 'Mailchimp outbound approval authority is invalid.');
      return { run: mapped, noOp: envelope.noOp === true };
    },
    async list(scope, connectionId, limit) {
      const query = input.authenticated.from('mailchimp_outbound_backfill_runs').select('*')
        .eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId)
        .order('previewed_at', { ascending: false }).limit(limit);
      const { data, error } = await query;
      if (error) throw persistenceError('Failed to list Mailchimp outbound backfills', error);
      return (data ?? []).map(run);
    },
    async scheduleDue(value) {
      const { data, error } = await input.service.rpc('schedule_due_mailchimp_outbound_backfill_runs', {
        target_now: value.now, target_interval_seconds: value.intervalSeconds, target_limit: value.limit,
      });
      if (error) throw persistenceError('Failed to schedule Mailchimp tag reconciliation', error);
      return (data ?? []).map(run);
    },
    async claim(value) {
      const { data, error } = await input.service.rpc('claim_mailchimp_outbound_backfill_runs', {
        target_worker_id: value.workerId, target_batch_size: value.batchSize,
        target_lease_seconds: value.leaseSeconds, target_now: value.now,
      });
      if (error) throw persistenceError('Failed to claim Mailchimp outbound backfills', error);
      return (data ?? []).map(run);
    },
    async start(value) {
      const { data, error } = await input.service.rpc('start_mailchimp_outbound_backfill_run', {
        target_run_id: value.runId, target_worker_id: value.workerId,
        target_fencing_token: value.fencingToken, target_started_at: value.startedAt,
      });
      if (error) throw workerError('Failed to start Mailchimp outbound backfill', error);
      return run(object(data, 'Mailchimp outbound start envelope is invalid.').run);
    },
    async readPage(value) {
      const { data, error } = await input.service.rpc('read_mailchimp_outbound_backfill_page', {
        target_run_id: value.runId, target_worker_id: value.workerId,
        target_fencing_token: value.fencingToken, target_now: value.now,
      });
      if (error) throw workerError('Failed to read Mailchimp outbound page', error);
      const envelope = object(data, 'Mailchimp outbound page is invalid.');
      const pageRun = object(envelope.run, 'Mailchimp outbound page run is missing.');
      const binding = object(envelope.binding, 'Mailchimp outbound page binding is missing.');
      const items = Array.isArray(envelope.items) ? envelope.items.map((candidate) => {
        const item = object(candidate, 'Mailchimp outbound page item is invalid.');
        const operation = object(item.operation, 'Mailchimp outbound operation is invalid.');
        return { itemIndex: integer(item.itemIndex, 'itemIndex'), operation: {
          audienceId: text(operation.audienceId, 'audienceId'), subscriberHash: text(operation.subscriberHash, 'subscriberHash'),
          desiredTag: text(operation.desiredTag, 'desiredTag') as 'Omnix: Hot' | 'Omnix: Warm' | 'Omnix: Nurture',
          mappingVersion: integer(operation.mappingVersion, 'mappingVersion', 1), operationKey: text(operation.operationKey, 'operationKey'),
        } };
      }) : (() => { throw new ConnectorError('conflict', 'Mailchimp outbound page items are invalid.'); })();
      return {
        run: {
          id: text(pageRun.runId, 'runId'), workspaceId: text(pageRun.workspaceId, 'workspaceId'),
          connectionId: text(pageRun.connectionId, 'connectionId'), bindingId: text(pageRun.bindingId, 'bindingId'),
          mode: text(pageRun.mode, 'mode') as 'backfill' | 'tag-reconcile',
          snapshotHash: text(pageRun.snapshotHash, 'snapshotHash'), mappingVersion: integer(pageRun.mappingVersion, 'mappingVersion', 1),
          pageSize: integer(pageRun.pageSize, 'pageSize', 1), eligibleCount: integer(pageRun.eligibleCount, 'eligibleCount'),
          nextOffset: integer(pageRun.nextOffset, 'nextOffset'), fencingToken: integer(pageRun.fencingToken, 'fencingToken'),
          leaseExpiresAt: text(pageRun.leaseExpiresAt, 'leaseExpiresAt'),
        },
        binding: {
          connectionId: text(binding.connectionId, 'connectionId'), workspaceId: text(binding.workspaceId, 'workspaceId'),
          bindingId: text(binding.bindingId, 'bindingId'), dataCenter: text(binding.dataCenter, 'dataCenter'),
          audienceId: text(binding.audienceId, 'audienceId'), accountIdHash: text(binding.accountIdHash, 'accountIdHash'),
          mappingVersion: integer(binding.mappingVersion, 'mappingVersion', 1),
        },
        offset: integer(envelope.offset, 'offset'), items, pageHash: text(envelope.pageHash, 'pageHash'), finalPage: envelope.finalPage === true,
      } satisfies MailchimpOutboundBackfillPage;
    },
    async enqueuePage(value) {
      const { data, error } = await input.service.rpc('enqueue_mailchimp_outbound_backfill_page', {
        target_run_id: value.runId, target_worker_id: value.workerId, target_fencing_token: value.fencingToken,
        target_expected_offset: value.offset, target_page_hash: value.pageHash,
        target_envelopes: value.envelopes.map(encrypted), target_occurred_at: value.occurredAt,
      });
      if (error) throw workerError('Failed to enqueue Mailchimp outbound page', error);
      const envelope = object(data, 'Mailchimp outbound enqueue envelope is invalid.');
      if (!Array.isArray(envelope.jobIds) || envelope.jobIds.some((id) => typeof id !== 'string')) {
        throw new ConnectorError('conflict', 'Mailchimp outbound job IDs are invalid.');
      }
      return { run: run(envelope.run), jobIds: envelope.jobIds as string[], finalPage: envelope.finalPage === true, noOp: envelope.noOp === true };
    },
    async settle(value) {
      const { data, error } = await input.service.rpc('settle_mailchimp_outbound_backfill_run', {
        target_run_id: value.runId, target_worker_id: value.workerId, target_fencing_token: value.fencingToken,
        target_retry_at: value.retryAt, target_occurred_at: value.occurredAt,
      });
      if (error) throw workerError('Failed to settle Mailchimp outbound backfill', error);
      const envelope = object(data, 'Mailchimp outbound settlement is invalid.');
      return { run: run(envelope.run), completed: envelope.completed === true, noOp: envelope.noOp === true };
    },
    async transition(value) {
      const { data, error } = await input.service.rpc('transition_mailchimp_outbound_backfill_run', {
        target_run_id: value.runId, target_worker_id: value.workerId, target_fencing_token: value.fencingToken,
        target_outcome: value.outcome, target_error_category: value.errorCategory,
        target_retry_at: value.retryAt ?? null, target_occurred_at: value.occurredAt,
      });
      if (error) throw workerError('Failed to transition Mailchimp outbound backfill', error);
      return run(object(data, 'Mailchimp outbound transition is invalid.').run);
    },
  };
}
