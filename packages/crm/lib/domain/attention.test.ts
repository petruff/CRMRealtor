import { describe, expect, it } from 'vitest';
import {
  effectiveAttentionPriority,
  sortAttentionQueue,
  transitionAttentionItem,
  validateAttentionMaterialization,
  type AttentionItem,
} from './attention';

const now = new Date('2026-08-24T14:00:00.000Z');

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'attention-1', workspaceId: 'workspace-1', rule: 'overdue-follow-up',
    category: 'follow-up', subjectType: 'contact', subjectId: 'contact-1',
    occurrenceKey: 'follow-up:contact-1', sourceFingerprint: 'a'.repeat(64),
    reason: 'Follow-up is overdue.', href: '/contacts/contact-1', priority: 'p2',
    dueAt: '2026-08-23T14:00:00.000Z', enqueuedAt: '2026-08-24T12:00:00.000Z',
    enqueueSequence: 1, lastSeenAt: '2026-08-24T12:00:00.000Z', state: 'open',
    version: 1, dismissAllowed: true, stateChangedAt: '2026-08-24T12:00:00.000Z',
    evidence: [], ...overrides,
  };
}

describe('attention domain', () => {
  it('validates a safe workspace materialization', () => {
    expect(validateAttentionMaterialization({
      rule: 'connection-health', category: 'connection', subjectType: 'workspace',
      occurrenceKey: 'connection-health:workspace', sourceFingerprint: 'b'.repeat(64),
      reason: 'Connection needs attention.', href: '/connections', priority: 'p0',
      dismissAllowed: false, evidence: [],
    })).toMatchObject({ subjectType: 'workspace', priority: 'p0' });
  });

  it('orders by effective priority, breached due time and FIFO sequence', () => {
    const ordered = sortAttentionQueue([
      item({ id: 'later', enqueueSequence: 3 }),
      item({ id: 'p0', priority: 'p0', enqueueSequence: 9 }),
      item({ id: 'first', enqueueSequence: 1 }),
      item({ id: 'future', dueAt: '2026-08-25T14:00:00.000Z', enqueueSequence: 0 }),
    ], now);
    expect(ordered.map((entry) => entry.id)).toEqual(['p0', 'first', 'later', 'future']);
  });

  it('ages only P2-P4 upward by one class', () => {
    expect(effectiveAttentionPriority(item({ priority: 'p3', enqueuedAt: '2026-08-10T00:00:00Z' }), now)).toBe('p2');
    expect(effectiveAttentionPriority(item({ priority: 'p0', enqueuedAt: '2025-01-01T00:00:00Z' }), now)).toBe('p0');
  });

  it('snoozes with optimistic concurrency and hides until due', () => {
    const result = transitionAttentionItem(item(), {
      transition: 'snooze', actorMembershipId: 'member-1', expectedVersion: 1,
      occurredAt: now.toISOString(), snoozedUntil: '2026-08-25T14:00:00Z',
      idempotencyKey: 'attention:snooze:1',
    });
    expect(result.item).toMatchObject({ state: 'snoozed', version: 2, snoozedUntil: '2026-08-25T14:00:00.000Z' });
    expect(sortAttentionQueue([result.item], now)).toEqual([]);
  });

  it('requires a reason and permission to dismiss', () => {
    expect(() => transitionAttentionItem(item({ dismissAllowed: false }), {
      transition: 'dismiss', actorMembershipId: 'member-1', expectedVersion: 1,
      occurredAt: now.toISOString(), reason: 'Not relevant', idempotencyKey: 'dismiss:1',
    })).toThrow(/source record/);
    expect(() => transitionAttentionItem(item(), {
      transition: 'dismiss', actorMembershipId: 'member-1', expectedVersion: 1,
      occurredAt: now.toISOString(), idempotencyKey: 'dismiss:2',
    })).toThrow(/reason/);
  });

  it('rejects stale versions', () => {
    expect(() => transitionAttentionItem(item(), {
      transition: 'complete', actorMembershipId: 'member-1', expectedVersion: 0,
      occurredAt: now.toISOString(), idempotencyKey: 'complete:1',
    })).toThrow(/changed/);
  });
});
