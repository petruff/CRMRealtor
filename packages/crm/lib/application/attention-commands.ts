import { createHash } from 'node:crypto';
import type {
  AttentionAutomationRepository,
  AttentionQuery,
  AttentionRepository,
} from '../data/attention-repository.ts';
import {
  AttentionError,
  ATTENTION_STATES,
  ATTENTION_TRANSITIONS,
  validateAttentionMaterialization,
  type AttentionMaterialization,
  type AttentionPriority,
  type AttentionState,
  type AttentionTransition,
} from '../domain/attention.ts';
import type { OmnixCopilotAlert } from '../domain/omnix-copilot.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

const PRIORITY_MAP: Readonly<Record<OmnixCopilotAlert['priority'], AttentionPriority>> = {
  urgent: 'p0', high: 'p1', normal: 'p3', low: 'p4',
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedLimit(value: unknown, fallback = 100): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new AttentionError('invalid-input', 'Attention list limit must be 1–500.');
  }
  return parsed;
}

function instant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AttentionError('invalid-input', `${field} is required.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new AttentionError('invalid-input', `${field} is invalid.`);
  return parsed.toISOString();
}

export function attentionMaterializationsFromAlerts(
  alerts: readonly OmnixCopilotAlert[],
): readonly AttentionMaterialization[] {
  const seen = new Set<string>();
  return Object.freeze(alerts.map((alert) => {
    const citation = alert.citations[0];
    const subjectType = citation?.entityType === 'task' ? 'task' : 'contact';
    const occurrenceKey = alert.occurrenceKey ?? `${alert.rule}:${alert.recordId}`;
    if (seen.has(occurrenceKey)) {
      throw new AttentionError('conflict', 'Canonical alerts produced a duplicate attention occurrence.');
    }
    seen.add(occurrenceKey);
    return validateAttentionMaterialization({
      rule: alert.rule,
      category: alert.category,
      subjectType,
      subjectId: alert.recordId,
      occurrenceKey,
      sourceFingerprint: alert.sourceFingerprint ?? hash({
        rule: alert.rule, recordId: alert.recordId,
        factKeys: alert.citations.flatMap((entry) => entry.factKeys).sort(),
        sourceTimestamps: alert.citations.map((entry) => entry.sourceTimestamp ?? null),
      }),
      reason: alert.reason,
      href: alert.href,
      priority: PRIORITY_MAP[alert.priority],
      ...(alert.dueAt ? { dueAt: alert.dueAt } : {}),
      dismissAllowed: alert.dismissAllowed ?? false,
      evidence: alert.citations.map((entry) => ({
        entityType: subjectType,
        recordId: entry.recordId,
        factKeys: entry.factKeys,
        ...(entry.sourceTimestamp ? { sourceTimestamp: entry.sourceTimestamp } : {}),
      })),
    });
  }));
}

export async function reconcileAttentionCommand(
  repository: AttentionAutomationRepository,
  scope: WorkspaceScope,
  alerts: readonly OmnixCopilotAlert[],
  observedAt: Date,
  idempotencyKey: string,
) {
  return repository.reconcile(
    scope,
    attentionMaterializationsFromAlerts(alerts),
    observedAt.toISOString(),
    idempotencyKey,
  );
}

export async function listAttentionCommand(
  repository: AttentionRepository,
  scope: WorkspaceScope,
  input: {
    readonly state?: AttentionState | 'active' | 'all';
    readonly assigneeMembershipId?: string;
    readonly limit?: number | string;
    readonly now?: Date;
  } = {},
) {
  if (input.state && input.state !== 'active' && input.state !== 'all'
    && !ATTENTION_STATES.includes(input.state)) {
    throw new AttentionError('invalid-input', 'Attention state is invalid.');
  }
  const query: AttentionQuery = {
    state: input.state ?? 'active',
    assigneeMembershipId: input.assigneeMembershipId,
    limit: boundedLimit(input.limit),
    now: (input.now ?? new Date()).toISOString(),
  };
  return repository.list(scope, query);
}

export async function transitionAttentionCommand(
  repository: AttentionRepository,
  scope: WorkspaceScope,
  id: unknown,
  input: {
    readonly transition: AttentionTransition;
    readonly expectedVersion: unknown;
    readonly snoozedUntil?: unknown;
    readonly reason?: unknown;
    readonly idempotencyKey: unknown;
  },
  now = new Date(),
) {
  if (typeof id !== 'string' || !id.trim()) throw new AttentionError('invalid-input', 'Attention item is required.');
  if (!ATTENTION_TRANSITIONS.includes(input.transition)) {
    throw new AttentionError('invalid-input', 'Attention transition is invalid.');
  }
  const expectedVersion = typeof input.expectedVersion === 'number'
    ? input.expectedVersion
    : Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new AttentionError('invalid-input', 'Expected version is invalid.');
  }
  if (typeof input.idempotencyKey !== 'string') {
    throw new AttentionError('invalid-input', 'Idempotency key is required.');
  }
  return repository.transition(scope, id.trim(), {
    transition: input.transition,
    actorMembershipId: scope.membershipId,
    expectedVersion,
    occurredAt: now.toISOString(),
    idempotencyKey: input.idempotencyKey,
    ...(input.snoozedUntil === undefined ? {} : { snoozedUntil: instant(input.snoozedUntil, 'snoozedUntil') }),
    ...(typeof input.reason === 'string' && input.reason.trim() ? { reason: input.reason.trim() } : {}),
  });
}
