export const ATTENTION_PRIORITIES = ['p0', 'p1', 'p2', 'p3', 'p4'] as const;
export type AttentionPriority = (typeof ATTENTION_PRIORITIES)[number];

export const ATTENTION_STATES = [
  'open', 'acknowledged', 'snoozed', 'completed', 'dismissed', 'escalated',
] as const;
export type AttentionState = (typeof ATTENTION_STATES)[number];

export const ATTENTION_SUBJECT_TYPES = ['contact', 'task', 'transaction', 'connection', 'workspace'] as const;
export type AttentionSubjectType = (typeof ATTENTION_SUBJECT_TYPES)[number];

export const ATTENTION_TRANSITIONS = [
  'acknowledge', 'snooze', 'complete', 'dismiss', 'escalate', 'reopen',
] as const;
export type AttentionTransition = (typeof ATTENTION_TRANSITIONS)[number];

export const ACTIVE_ATTENTION_STATES: readonly AttentionState[] = [
  'open', 'acknowledged', 'snoozed', 'escalated',
];

export interface AttentionEvidence {
  readonly entityType: AttentionSubjectType;
  readonly recordId: string;
  readonly factKeys: readonly string[];
  readonly sourceTimestamp?: string;
}

export interface AttentionItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly rule: string;
  readonly category: string;
  readonly subjectType: AttentionSubjectType;
  readonly subjectId?: string;
  readonly occurrenceKey: string;
  readonly sourceFingerprint: string;
  readonly reason: string;
  readonly href: string;
  readonly priority: AttentionPriority;
  readonly dueAt?: string;
  readonly enqueuedAt: string;
  readonly enqueueSequence: number;
  readonly lastSeenAt: string;
  readonly assigneeMembershipId?: string;
  readonly state: AttentionState;
  readonly version: number;
  readonly dismissAllowed: boolean;
  readonly snoozedUntil?: string;
  readonly stateChangedAt: string;
  readonly stateChangedByMembershipId?: string;
  readonly stateChangeReason?: string;
  readonly evidence: readonly AttentionEvidence[];
}

export interface AttentionMaterialization {
  readonly rule: string;
  readonly category: string;
  readonly subjectType: AttentionSubjectType;
  readonly subjectId?: string;
  readonly occurrenceKey: string;
  readonly sourceFingerprint: string;
  readonly reason: string;
  readonly href: string;
  readonly priority: AttentionPriority;
  readonly dueAt?: string;
  readonly assigneeMembershipId?: string;
  readonly dismissAllowed: boolean;
  readonly evidence: readonly AttentionEvidence[];
}

export interface AttentionLifecycleEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly attentionItemId: string;
  readonly fromState?: AttentionState;
  readonly toState: AttentionState;
  readonly actorKind: 'member' | 'system';
  readonly actorMembershipId?: string;
  readonly reasonCode: string;
  readonly sourceFingerprint: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface AttentionTransitionInput {
  readonly transition: AttentionTransition;
  readonly actorMembershipId: string;
  readonly expectedVersion: number;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly snoozedUntil?: string;
  readonly reason?: string;
}

export class AttentionError extends Error {
  readonly code: 'invalid-input' | 'not-found' | 'conflict' | 'forbidden' | 'scope-mismatch';
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    code: AttentionError['code'],
    message: string,
    fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'AttentionError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const KEY = /^[A-Za-z0-9._:-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value.trim())) {
    throw new AttentionError('invalid-input', `${field} is invalid.`, {
      [field]: 'Use 1–128 letters, numbers, dashes, or underscores.',
    });
  }
  return value.trim();
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new AttentionError('invalid-input', `${field} is required.`, { [field]: 'Enter text.' });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AttentionError('invalid-input', `${field} is invalid.`, {
      [field]: `Use 1–${maximum} printable characters.`,
    });
  }
  return normalized;
}

function instant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AttentionError('invalid-input', `${field} is required.`, { [field]: 'Use an ISO date/time.' });
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AttentionError('invalid-input', `${field} is invalid.`, { [field]: 'Use an ISO date/time.' });
  }
  return parsed.toISOString();
}

export function validateAttentionMaterialization(input: AttentionMaterialization): AttentionMaterialization {
  const occurrenceKey = boundedText(input.occurrenceKey, 'occurrenceKey', 200);
  if (!KEY.test(occurrenceKey)) {
    throw new AttentionError('invalid-input', 'occurrenceKey is invalid.');
  }
  if (!SHA256.test(input.sourceFingerprint)) {
    throw new AttentionError('invalid-input', 'sourceFingerprint must be a SHA-256 digest.');
  }
  if (!ATTENTION_SUBJECT_TYPES.includes(input.subjectType)) {
    throw new AttentionError('invalid-input', 'subjectType is invalid.');
  }
  if (input.subjectType === 'workspace' ? input.subjectId !== undefined : !input.subjectId) {
    throw new AttentionError('invalid-input', 'Attention subject does not match its type.');
  }
  if (!ATTENTION_PRIORITIES.includes(input.priority)) {
    throw new AttentionError('invalid-input', 'priority is invalid.');
  }
  const href = boundedText(input.href, 'href', 500);
  if (!href.startsWith('/') || href.startsWith('//')) {
    throw new AttentionError('invalid-input', 'href must be a safe in-product path.');
  }
  if (!Array.isArray(input.evidence) || input.evidence.length > 20) {
    throw new AttentionError('invalid-input', 'evidence is invalid.');
  }
  return Object.freeze({
    rule: boundedText(input.rule, 'rule', 80),
    category: boundedText(input.category, 'category', 80),
    subjectType: input.subjectType,
    ...(input.subjectId ? { subjectId: identifier(input.subjectId, 'subjectId') } : {}),
    occurrenceKey,
    sourceFingerprint: input.sourceFingerprint,
    reason: boundedText(input.reason, 'reason', 500),
    href,
    priority: input.priority,
    ...(input.dueAt ? { dueAt: instant(input.dueAt, 'dueAt') } : {}),
    ...(input.assigneeMembershipId
      ? { assigneeMembershipId: identifier(input.assigneeMembershipId, 'assigneeMembershipId') }
      : {}),
    dismissAllowed: input.dismissAllowed,
    evidence: Object.freeze(input.evidence.map((entry) => Object.freeze({
      entityType: entry.entityType,
      recordId: identifier(entry.recordId, 'evidence.recordId'),
      factKeys: Object.freeze(entry.factKeys.map((key: string) => boundedText(key, 'evidence.factKey', 80))),
      ...(entry.sourceTimestamp ? { sourceTimestamp: instant(entry.sourceTimestamp, 'evidence.sourceTimestamp') } : {}),
    }))),
  });
}

const PRIORITY_RANK: Readonly<Record<AttentionPriority, number>> = {
  p0: 0, p1: 1, p2: 2, p3: 3, p4: 4,
};

/** P2–P4 work can age upward by one class after seven days; P0/P1 never change. */
export function effectiveAttentionPriority(item: AttentionItem, now: Date): AttentionPriority {
  const rank = PRIORITY_RANK[item.priority];
  if (rank < 2) return item.priority;
  const age = Math.max(0, now.getTime() - new Date(item.enqueuedAt).getTime());
  if (age < 7 * 86_400_000) return item.priority;
  return ATTENTION_PRIORITIES[Math.max(1, rank - 1)] ?? item.priority;
}

export function attentionIsVisible(item: AttentionItem, now: Date): boolean {
  if (!ACTIVE_ATTENTION_STATES.includes(item.state)) return false;
  return item.state !== 'snoozed'
    || !item.snoozedUntil
    || new Date(item.snoozedUntil).getTime() <= now.getTime();
}

export function sortAttentionQueue(items: readonly AttentionItem[], now = new Date()): AttentionItem[] {
  return [...items].filter((item) => attentionIsVisible(item, now)).sort((left, right) => {
    const priority = PRIORITY_RANK[effectiveAttentionPriority(left, now)]
      - PRIORITY_RANK[effectiveAttentionPriority(right, now)];
    if (priority) return priority;
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const leftBreached = leftDue <= now.getTime() ? 0 : 1;
    const rightBreached = rightDue <= now.getTime() ? 0 : 1;
    return leftBreached - rightBreached
      || leftDue - rightDue
      || left.enqueueSequence - right.enqueueSequence
      || left.id.localeCompare(right.id);
  });
}

function transitionTarget(transition: AttentionTransition): AttentionState {
  if (transition === 'acknowledge') return 'acknowledged';
  if (transition === 'snooze') return 'snoozed';
  if (transition === 'complete') return 'completed';
  if (transition === 'dismiss') return 'dismissed';
  if (transition === 'escalate') return 'escalated';
  return 'open';
}

export function transitionAttentionItem(
  item: AttentionItem,
  input: AttentionTransitionInput,
): { item: AttentionItem; event: Omit<AttentionLifecycleEvent, 'id' | 'workspaceId' | 'attentionItemId'>; noOp: boolean } {
  if (input.expectedVersion !== item.version) {
    throw new AttentionError('conflict', 'This item changed after it was opened. Refresh and try again.');
  }
  const occurredAt = instant(input.occurredAt, 'occurredAt');
  const actorMembershipId = identifier(input.actorMembershipId, 'actorMembershipId');
  const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 128);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    throw new AttentionError('invalid-input', 'idempotencyKey is invalid.');
  }
  const target = transitionTarget(input.transition);
  if (target === item.state && input.transition !== 'snooze') {
    return {
      item,
      noOp: true,
      event: {
        fromState: item.state,
        toState: item.state,
        actorKind: 'member',
        actorMembershipId,
        reasonCode: `member-${input.transition}-noop`,
        sourceFingerprint: item.sourceFingerprint,
        idempotencyKey,
        occurredAt,
      },
    };
  }
  if (input.transition === 'dismiss' && !item.dismissAllowed) {
    throw new AttentionError('forbidden', 'This item must be resolved from its source record.');
  }
  if (input.transition === 'reopen' && !['completed', 'dismissed'].includes(item.state)) {
    throw new AttentionError('conflict', 'Only completed or dismissed items can be reopened.');
  }
  if (input.transition !== 'reopen' && ['completed', 'dismissed'].includes(item.state)) {
    throw new AttentionError('conflict', 'This item is closed. Reopen it before another transition.');
  }
  let snoozedUntil: string | undefined;
  if (input.transition === 'snooze') {
    snoozedUntil = instant(input.snoozedUntil, 'snoozedUntil');
    if (new Date(snoozedUntil).getTime() <= new Date(occurredAt).getTime()) {
      throw new AttentionError('invalid-input', 'Choose a snooze time in the future.', {
        snoozedUntil: 'Choose a future date and time.',
      });
    }
  }
  const reason = input.reason ? boundedText(input.reason, 'reason', 500) : undefined;
  if (input.transition === 'dismiss' && !reason) {
    throw new AttentionError('invalid-input', 'A dismissal reason is required.', {
      reason: 'Explain why this item no longer needs attention.',
    });
  }
  const next: AttentionItem = Object.freeze({
    ...item,
    state: target,
    version: item.version + 1,
    stateChangedAt: occurredAt,
    stateChangedByMembershipId: actorMembershipId,
    ...(reason ? { stateChangeReason: reason } : {}),
    ...(snoozedUntil ? { snoozedUntil } : {}),
  });
  return {
    item: next,
    noOp: false,
    event: {
      fromState: item.state,
      toState: target,
      actorKind: 'member',
      actorMembershipId,
      reasonCode: reason ?? `member-${input.transition}`,
      sourceFingerprint: item.sourceFingerprint,
      idempotencyKey,
      occurredAt,
    },
  };
}
