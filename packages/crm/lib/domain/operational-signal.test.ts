import { describe, expect, it } from 'vitest';
import { compareOperationalDeadline, milestoneDaysOverdue, validateTransactionMilestoneInput, type TransactionMilestone } from './operational-signal';

const BASE: TransactionMilestone = {
  id: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  transactionId: '00000000-0000-4000-8000-000000000003', contactId: '00000000-0000-4000-8000-000000000004',
  contactName: 'Morgan Ellis', propertyAddress: '1 Main Street', potentialValueCents: 900000, kind: 'inspection', label: 'Inspection period',
  state: 'open', dueAt: '2026-08-20T16:00:00.000Z', responsibleMembershipId: '00000000-0000-4000-8000-000000000005', source: 'manual', currentVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('operational signals', () => {
  it('normalizes a real transaction deadline', () => {
    expect(validateTransactionMilestoneInput({ transactionId: BASE.transactionId, kind: 'title', label: '  Title   commitment ', dueAt: '2026-09-01T12:00:00Z', idempotencyKey: BASE.id }).label).toBe('Title commitment');
  });
  it('computes overdue days only for open milestones', () => {
    expect(milestoneDaysOverdue(BASE, new Date('2026-08-23T16:00:00Z'))).toBe(3);
    expect(milestoneDaysOverdue({ ...BASE, state: 'completed' }, new Date('2026-08-23T16:00:00Z'))).toBe(0);
  });
  it('orders equal-priority deadlines FIFO', () => {
    expect(compareOperationalDeadline(BASE, { ...BASE, id: '00000000-0000-4000-8000-000000000009', dueAt: '2026-08-21T00:00:00Z' })).toBeLessThan(0);
  });
});
