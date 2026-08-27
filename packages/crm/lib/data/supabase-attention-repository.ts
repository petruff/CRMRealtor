import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTIVE_ATTENTION_STATES,
  ATTENTION_PRIORITIES,
  ATTENTION_STATES,
  ATTENTION_SUBJECT_TYPES,
  AttentionError,
  sortAttentionQueue,
  type AttentionEvidence,
  type AttentionItem,
  type AttentionLifecycleEvent,
} from '../domain/attention.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type {
  AttentionAutomationRepository,
  AttentionQuery,
  AttentionReconciliationResult,
  AttentionRepository,
} from './attention-repository.ts';

interface AttentionRow {
  id: string;
  workspace_id: string;
  rule: string;
  category: string;
  subject_type: string;
  subject_id: string | null;
  occurrence_key: string;
  source_fingerprint: string;
  reason: string;
  href: string;
  priority: string;
  due_at: string | null;
  enqueued_at: string;
  enqueue_sequence: number;
  last_seen_at: string;
  assignee_membership_id: string | null;
  state: string;
  item_version: number;
  dismiss_allowed: boolean;
  snoozed_until: string | null;
  state_changed_at: string;
  state_changed_by_membership_id: string | null;
  state_change_reason: string | null;
  evidence: unknown;
}

interface AttentionEventRow {
  id: string;
  workspace_id: string;
  attention_item_id: string;
  from_state: string | null;
  to_state: string;
  actor_kind: string;
  actor_membership_id: string | null;
  reason_code: string;
  source_fingerprint: string;
  idempotency_key: string;
  occurred_at: string;
}

const ITEM_COLUMNS = [
  'id', 'workspace_id', 'rule', 'category', 'subject_type', 'subject_id',
  'occurrence_key', 'source_fingerprint', 'reason', 'href', 'priority', 'due_at',
  'enqueued_at', 'enqueue_sequence', 'last_seen_at', 'assignee_membership_id',
  'state', 'item_version', 'dismiss_allowed', 'snoozed_until', 'state_changed_at',
  'state_changed_by_membership_id', 'state_change_reason', 'evidence',
].join(', ');
const EVENT_COLUMNS = [
  'id', 'workspace_id', 'attention_item_id', 'from_state', 'to_state',
  'actor_kind', 'actor_membership_id', 'reason_code', 'source_fingerprint',
  'idempotency_key', 'occurred_at',
].join(', ');

function liveScope(input: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(input);
  if (scope.mode !== 'live') throw new AttentionError('scope-mismatch', 'Live attention requires a live workspace.');
  return scope;
}

function boundedLimit(value: number, maximum = 500): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AttentionError('invalid-input', `Attention limit must be 1–${maximum}.`);
  }
  return value;
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new AttentionError('forbidden', message);
  if (error.code === '40001' || error.code === '23505') return new AttentionError('conflict', message);
  if (error.code === 'P0002') return new AttentionError('not-found', message);
  if (error.code === '22023' || error.code === '23514') return new AttentionError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function evidence(value: unknown): readonly AttentionEvidence[] {
  if (!Array.isArray(value)) throw new AttentionError('conflict', 'Attention evidence is invalid.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AttentionError('conflict', 'Attention evidence is invalid.');
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.entityType !== 'string' || !ATTENTION_SUBJECT_TYPES.includes(item.entityType as AttentionEvidence['entityType'])
      || typeof item.recordId !== 'string' || !Array.isArray(item.factKeys)
      || item.factKeys.some((key) => typeof key !== 'string')) {
      throw new AttentionError('conflict', 'Attention evidence is invalid.');
    }
    return {
      entityType: item.entityType as AttentionEvidence['entityType'],
      recordId: item.recordId,
      factKeys: item.factKeys as string[],
      ...(typeof item.sourceTimestamp === 'string' ? { sourceTimestamp: item.sourceTimestamp } : {}),
    };
  });
}

export function attentionItemFromRow(row: AttentionRow): AttentionItem {
  if (!ATTENTION_PRIORITIES.includes(row.priority as AttentionItem['priority'])
    || !ATTENTION_STATES.includes(row.state as AttentionItem['state'])
    || !ATTENTION_SUBJECT_TYPES.includes(row.subject_type as AttentionItem['subjectType'])) {
    throw new AttentionError('conflict', 'Attention persistence returned an invalid item.');
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    rule: row.rule,
    category: row.category,
    subjectType: row.subject_type as AttentionItem['subjectType'],
    ...(row.subject_id ? { subjectId: row.subject_id } : {}),
    occurrenceKey: row.occurrence_key,
    sourceFingerprint: row.source_fingerprint,
    reason: row.reason,
    href: row.href,
    priority: row.priority as AttentionItem['priority'],
    ...(row.due_at ? { dueAt: row.due_at } : {}),
    enqueuedAt: row.enqueued_at,
    enqueueSequence: Number(row.enqueue_sequence),
    lastSeenAt: row.last_seen_at,
    ...(row.assignee_membership_id ? { assigneeMembershipId: row.assignee_membership_id } : {}),
    state: row.state as AttentionItem['state'],
    version: row.item_version,
    dismissAllowed: row.dismiss_allowed,
    ...(row.snoozed_until ? { snoozedUntil: row.snoozed_until } : {}),
    stateChangedAt: row.state_changed_at,
    ...(row.state_changed_by_membership_id
      ? { stateChangedByMembershipId: row.state_changed_by_membership_id }
      : {}),
    ...(row.state_change_reason ? { stateChangeReason: row.state_change_reason } : {}),
    evidence: evidence(row.evidence),
  };
}

function eventFromRow(row: AttentionEventRow): AttentionLifecycleEvent {
  if (!ATTENTION_STATES.includes(row.to_state as AttentionLifecycleEvent['toState'])
    || (row.from_state && !ATTENTION_STATES.includes(row.from_state as AttentionLifecycleEvent['toState']))
    || !['member', 'system'].includes(row.actor_kind)) {
    throw new AttentionError('conflict', 'Attention persistence returned an invalid event.');
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    attentionItemId: row.attention_item_id,
    ...(row.from_state ? { fromState: row.from_state as AttentionLifecycleEvent['toState'] } : {}),
    toState: row.to_state as AttentionLifecycleEvent['toState'],
    actorKind: row.actor_kind as AttentionLifecycleEvent['actorKind'],
    ...(row.actor_membership_id ? { actorMembershipId: row.actor_membership_id } : {}),
    reasonCode: row.reason_code,
    sourceFingerprint: row.source_fingerprint,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
  };
}

function envelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AttentionError('conflict', 'Attention persistence returned an invalid receipt.');
  }
  return value as Record<string, unknown>;
}

export function supabaseAttentionRepository(
  supabase: SupabaseClient,
): AttentionRepository & AttentionAutomationRepository {
  const repository: AttentionRepository & AttentionAutomationRepository = {
    async list(untrustedScope, query: AttentionQuery) {
      const scope = liveScope(untrustedScope);
      const now = new Date(query.now);
      if (!Number.isFinite(now.getTime())) throw new AttentionError('invalid-input', 'Queue time is invalid.');
      let request = supabase.from('attention_items').select(ITEM_COLUMNS).eq('workspace_id', scope.workspaceId);
      const requestedState = query.state ?? 'active';
      if (requestedState === 'active') request = request.in('state', [...ACTIVE_ATTENTION_STATES]);
      else if (requestedState !== 'all') request = request.eq('state', requestedState);
      if (query.assigneeMembershipId) request = request.eq('assignee_membership_id', query.assigneeMembershipId);
      const { data, error } = await request.limit(boundedLimit(query.limit));
      if (error) throw persistenceError('Failed to list attention', error);
      const items = ((data ?? []) as unknown as AttentionRow[]).map(attentionItemFromRow);
      return requestedState === 'active'
        ? sortAttentionQueue(items, now).slice(0, query.limit)
        : items.sort((left, right) => right.stateChangedAt.localeCompare(left.stateChangedAt));
    },

    async get(untrustedScope, id) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await supabase.from('attention_items').select(ITEM_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', id).maybeSingle();
      if (error) throw persistenceError('Failed to load attention', error);
      return data ? attentionItemFromRow(data as unknown as AttentionRow) : undefined;
    },

    async transition(untrustedScope, id, input) {
      const scope = liveScope(untrustedScope);
      if (input.actorMembershipId !== scope.membershipId) {
        throw new AttentionError('forbidden', 'Attention actor does not match workspace authority.');
      }
      const { data, error } = await supabase.rpc('transition_attention_item', {
        target_workspace_id: scope.workspaceId,
        target_item_id: id,
        target_expected_version: input.expectedVersion,
        target_transition: input.transition,
        target_actor_membership_id: input.actorMembershipId,
        target_occurred_at: input.occurredAt,
        target_idempotency_key: input.idempotencyKey,
        target_snoozed_until: input.snoozedUntil ?? null,
        target_reason: input.reason ?? null,
      });
      if (error) throw persistenceError('Failed to update attention', error);
      const receipt = envelope(data);
      if (!receipt.item || typeof receipt.noOp !== 'boolean') {
        throw new AttentionError('conflict', 'Attention transition receipt is incomplete.');
      }
      return {
        item: attentionItemFromRow(receipt.item as AttentionRow),
        ...(receipt.event ? { event: eventFromRow(receipt.event as AttentionEventRow) } : {}),
        noOp: receipt.noOp,
      };
    },

    async listEvents(untrustedScope, attentionItemId, limit) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await supabase.from('attention_lifecycle_events').select(EVENT_COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('attention_item_id', attentionItemId)
        .order('occurred_at', { ascending: false }).order('id', { ascending: true })
        .limit(boundedLimit(limit, 200));
      if (error) throw persistenceError('Failed to list attention history', error);
      return ((data ?? []) as unknown as AttentionEventRow[]).map(eventFromRow);
    },

    async reconcile(untrustedScope, materializations, observedAt, idempotencyKey) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await supabase.rpc('reconcile_attention_items', {
        target_workspace_id: scope.workspaceId,
        target_materializations: materializations,
        target_observed_at: observedAt,
        target_idempotency_key: idempotencyKey,
      });
      if (error) throw persistenceError('Failed to reconcile attention', error);
      const receipt = envelope(data);
      const active = await repository.list(scope, { state: 'active', limit: 500, now: observedAt });
      return {
        runId: String(receipt.runId ?? ''),
        noOp: Boolean(receipt.noOp),
        materialized: Number(receipt.materialized ?? 0),
        refreshed: Number(receipt.refreshed ?? 0),
        reopened: Number(receipt.reopened ?? 0),
        resolved: Number(receipt.resolved ?? 0),
        active,
      } satisfies AttentionReconciliationResult;
    },
  };
  return repository;
}
