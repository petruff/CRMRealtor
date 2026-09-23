import { describe, expect, it } from 'vitest';
import {
  compareOmnixApprovalQueue,
  scoreOmnixPriority,
  validateCreateOmnixProposal,
  type OmnixActionProposal,
} from './omnix-operational-brain.ts';

const proposal = (overrides: Partial<OmnixActionProposal>): OmnixActionProposal => ({
  id: 'proposal-a', workspaceId: 'workspace-a', kind: 'task-create', state: 'pending',
  origin: 'deterministic', approvalMode: 'active-member', priority: 'p3', priorityScore: 200_000,
  priorityFactors: { urgency: 25, leadTemperature: 'warm', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
  title: 'Call Alicia', rationale: 'Follow-up is due.', currentVersion: 1, correlationId: 'correlation-a',
  expiresAt: '2026-09-02T12:00:00.000Z', createdAt: '2026-08-31T12:00:00.000Z',
  updatedAt: '2026-08-31T12:00:00.000Z', ...overrides,
});

describe('Omnix operational brain', () => {
  it('prioritizes urgency, heat, delay, replies, and potential value with a bounded score', () => {
    const ranked = scoreOmnixPriority({
      urgency: 100, leadTemperature: 'hot', daysOverdue: 90, awaitingReply: true,
      potentialValueCents: 900_000_000,
    });
    expect(ranked).toMatchObject({ score: 1_000_000, priority: 'p0' });
  });

  it('uses due time and stable FIFO order when scores are equal', () => {
    const queue = [
      proposal({ id: 'later', createdAt: '2026-08-31T12:01:00.000Z' }),
      proposal({ id: 'first', createdAt: '2026-08-31T12:00:00.000Z' }),
      proposal({ id: 'urgent', priorityScore: 400_000 }),
    ].sort(compareOmnixApprovalQueue);
    expect(queue.map((item) => item.id)).toEqual(['urgent', 'first', 'later']);
  });

  it('requires cited, hashed, expiring proposals', () => {
    expect(() => validateCreateOmnixProposal({
      kind: 'task-create', origin: 'gemini', approvalMode: 'active-member',
      factors: { urgency: 50, leadTemperature: 'hot', daysOverdue: 2, awaitingReply: false, potentialValueCents: 0 },
      title: 'Create follow-up', rationale: 'The current follow-up is overdue.', payload: { dueAt: '2026-09-01' },
      contentHash: 'a'.repeat(64), citations: [], expiresAt: '2026-09-01T12:00:00.000Z',
      correlationId: 'correlation-1', idempotencyKey: 'proposal:1', createdAt: '2026-08-31T12:00:00.000Z',
    })).toThrow('citations are required');
  });
});
