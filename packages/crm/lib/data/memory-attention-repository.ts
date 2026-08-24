import {
  ACTIVE_ATTENTION_STATES,
  AttentionError,
  sortAttentionQueue,
  transitionAttentionItem,
  validateAttentionMaterialization,
  type AttentionItem,
  type AttentionLifecycleEvent,
  type AttentionState,
} from '../domain/attention.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type {
  AttentionAutomationRepository,
  AttentionQuery,
  AttentionReconciliationResult,
  AttentionRepository,
} from './attention-repository.ts';

interface MemoryAttentionOptions {
  readonly initialItems?: readonly AttentionItem[];
  readonly initialEvents?: readonly AttentionLifecycleEvent[];
  readonly activeMembershipIds?: readonly string[];
}

function assertScope(scope: WorkspaceScope): WorkspaceScope {
  return validateWorkspaceScope(scope);
}

function cloneItem(item: AttentionItem): AttentionItem {
  return Object.freeze({ ...item, evidence: Object.freeze(item.evidence.map((entry) => Object.freeze({
    ...entry, factKeys: Object.freeze([...entry.factKeys]),
  }))) });
}

function stateMatches(state: AttentionState, requested: AttentionQuery['state']): boolean {
  if (!requested || requested === 'active') return ACTIVE_ATTENTION_STATES.includes(state);
  return requested === 'all' || state === requested;
}

export function createMemoryAttentionRepository(
  options: MemoryAttentionOptions = {},
): AttentionRepository & AttentionAutomationRepository {
  let itemCounter = options.initialItems?.length ?? 0;
  let eventCounter = options.initialEvents?.length ?? 0;
  let runCounter = 0;
  const items = new Map((options.initialItems ?? []).map((item) => [item.id, cloneItem(item)]));
  const events = [...(options.initialEvents ?? [])];
  const runs = new Map<string, AttentionReconciliationResult>();
  const activeMembershipIds = new Set(options.activeMembershipIds ?? []);

  const assertMember = (scope: WorkspaceScope, membershipId: string) => {
    if (membershipId !== scope.membershipId || (activeMembershipIds.size && !activeMembershipIds.has(membershipId))) {
      throw new AttentionError('forbidden', 'An active workspace membership is required.');
    }
  };

  const appendEvent = (
    item: AttentionItem,
    input: Omit<AttentionLifecycleEvent, 'id' | 'workspaceId' | 'attentionItemId'>,
  ): AttentionLifecycleEvent => {
    const replay = events.find((event) => event.workspaceId === item.workspaceId
      && event.idempotencyKey === input.idempotencyKey);
    if (replay) return replay;
    eventCounter += 1;
    const event = Object.freeze({
      ...input,
      id: `attention-event-${String(eventCounter).padStart(4, '0')}`,
      workspaceId: item.workspaceId,
      attentionItemId: item.id,
    });
    events.push(event);
    return event;
  };

  const repository: AttentionRepository & AttentionAutomationRepository = {
    async list(untrustedScope, query) {
      const scope = assertScope(untrustedScope);
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) {
        throw new AttentionError('invalid-input', 'Attention list limit must be 1–500.');
      }
      const now = new Date(query.now);
      if (!Number.isFinite(now.getTime())) throw new AttentionError('invalid-input', 'Queue time is invalid.');
      const scoped = [...items.values()].filter((item) => item.workspaceId === scope.workspaceId
        && stateMatches(item.state, query.state)
        && (!query.assigneeMembershipId || item.assigneeMembershipId === query.assigneeMembershipId));
      if (query.state && query.state !== 'active') {
        return scoped.sort((left, right) => right.stateChangedAt.localeCompare(left.stateChangedAt)
          || left.id.localeCompare(right.id)).slice(0, query.limit).map(cloneItem);
      }
      return sortAttentionQueue(scoped, now).slice(0, query.limit).map(cloneItem);
    },

    async get(untrustedScope, id) {
      const scope = assertScope(untrustedScope);
      const item = items.get(id);
      return item?.workspaceId === scope.workspaceId ? cloneItem(item) : undefined;
    },

    async transition(untrustedScope, id, input) {
      const scope = assertScope(untrustedScope);
      assertMember(scope, input.actorMembershipId);
      const existing = items.get(id);
      if (!existing || existing.workspaceId !== scope.workspaceId) {
        throw new AttentionError('not-found', 'Attention item was not found.');
      }
      const replay = events.find((event) => event.workspaceId === scope.workspaceId
        && event.idempotencyKey === input.idempotencyKey);
      if (replay) return { item: cloneItem(existing), event: replay, noOp: true };
      const transitioned = transitionAttentionItem(existing, input);
      if (transitioned.noOp) return { item: cloneItem(existing), noOp: true };
      items.set(id, transitioned.item);
      const event = appendEvent(transitioned.item, transitioned.event);
      return { item: cloneItem(transitioned.item), event, noOp: false };
    },

    async listEvents(untrustedScope, attentionItemId, limit) {
      const scope = assertScope(untrustedScope);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new AttentionError('invalid-input', 'Attention event limit must be 1–200.');
      }
      if (!items.has(attentionItemId) || items.get(attentionItemId)?.workspaceId !== scope.workspaceId) return [];
      return events.filter((event) => event.workspaceId === scope.workspaceId
        && event.attentionItemId === attentionItemId)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
        .slice(0, limit);
    },

    async reconcile(untrustedScope, materializations, observedAtValue, idempotencyKey) {
      const scope = assertScope(untrustedScope);
      const observedAt = new Date(observedAtValue);
      if (!Number.isFinite(observedAt.getTime())) throw new AttentionError('invalid-input', 'Observed time is invalid.');
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
        throw new AttentionError('invalid-input', 'Reconciliation idempotency key is invalid.');
      }
      const runKey = `${scope.workspaceId}:${idempotencyKey}`;
      const replay = runs.get(runKey);
      if (replay) return { ...replay, noOp: true };
      if (materializations.length > 500) throw new AttentionError('invalid-input', 'Reconciliation accepts at most 500 items.');
      const validated = materializations.map(validateAttentionMaterialization);
      const occurrenceKeys = new Set<string>();
      let materialized = 0;
      let refreshed = 0;
      let reopened = 0;
      let resolved = 0;
      for (const input of validated) {
        if (occurrenceKeys.has(input.occurrenceKey)) {
          throw new AttentionError('invalid-input', 'Reconciliation contains a duplicate occurrence key.');
        }
        occurrenceKeys.add(input.occurrenceKey);
        const existing = [...items.values()].find((candidate) => candidate.workspaceId === scope.workspaceId
          && candidate.occurrenceKey === input.occurrenceKey);
        if (!existing) {
          itemCounter += 1;
          const created: AttentionItem = Object.freeze({
            ...input,
            id: `attention-${String(itemCounter).padStart(4, '0')}`,
            workspaceId: scope.workspaceId,
            enqueuedAt: observedAt.toISOString(),
            enqueueSequence: itemCounter,
            lastSeenAt: observedAt.toISOString(),
            state: 'open',
            version: 1,
            stateChangedAt: observedAt.toISOString(),
          });
          items.set(created.id, created);
          appendEvent(created, {
            toState: 'open', actorKind: 'system', reasonCode: 'source-materialized',
            sourceFingerprint: created.sourceFingerprint,
            idempotencyKey: `${idempotencyKey}:materialized:${created.occurrenceKey}`,
            occurredAt: observedAt.toISOString(),
          });
          materialized += 1;
          continue;
        }
        const fingerprintChanged = existing.sourceFingerprint !== input.sourceFingerprint;
        const snoozeExpired = existing.state === 'snoozed' && existing.snoozedUntil
          && new Date(existing.snoozedUntil).getTime() <= observedAt.getTime();
        const nextState: AttentionState = fingerprintChanged || snoozeExpired ? 'open' : existing.state;
        const next: AttentionItem = Object.freeze({
          ...existing,
          ...input,
          lastSeenAt: observedAt.toISOString(),
          state: nextState,
          version: fingerprintChanged || snoozeExpired ? existing.version + 1 : existing.version,
          stateChangedAt: fingerprintChanged || snoozeExpired ? observedAt.toISOString() : existing.stateChangedAt,
          ...(fingerprintChanged || snoozeExpired ? { stateChangeReason: fingerprintChanged ? 'source-changed' : 'snooze-ended' } : {}),
        });
        items.set(existing.id, next);
        if (fingerprintChanged || snoozeExpired) {
          reopened += 1;
          appendEvent(next, {
            fromState: existing.state, toState: 'open', actorKind: 'system',
            reasonCode: fingerprintChanged ? 'source-changed' : 'snooze-ended',
            sourceFingerprint: next.sourceFingerprint,
            idempotencyKey: `${idempotencyKey}:reopened:${next.occurrenceKey}`,
            occurredAt: observedAt.toISOString(),
          });
        } else refreshed += 1;
      }
      for (const existing of [...items.values()]) {
        if (existing.workspaceId !== scope.workspaceId
          || occurrenceKeys.has(existing.occurrenceKey)
          || !ACTIVE_ATTENTION_STATES.includes(existing.state)) continue;
        const closed: AttentionItem = Object.freeze({
          ...existing, state: 'completed', version: existing.version + 1,
          stateChangedAt: observedAt.toISOString(), stateChangeReason: 'source-cleared',
        });
        items.set(existing.id, closed);
        appendEvent(closed, {
          fromState: existing.state, toState: 'completed', actorKind: 'system',
          reasonCode: 'source-cleared', sourceFingerprint: existing.sourceFingerprint,
          idempotencyKey: `${idempotencyKey}:resolved:${existing.occurrenceKey}`,
          occurredAt: observedAt.toISOString(),
        });
        resolved += 1;
      }
      runCounter += 1;
      const active = sortAttentionQueue([...items.values()].filter((item) => item.workspaceId === scope.workspaceId), observedAt);
      const result: AttentionReconciliationResult = Object.freeze({
        runId: `attention-run-${String(runCounter).padStart(4, '0')}`,
        noOp: materialized === 0 && reopened === 0 && resolved === 0,
        materialized, refreshed, reopened, resolved,
        active: Object.freeze(active.map(cloneItem)),
      });
      runs.set(runKey, result);
      return result;
    },
  };
  return repository;
}
