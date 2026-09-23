import { describe, expect, it } from 'vitest';
import { compareOperationalDeadline, milestoneDaysOverdue, validateTransactionMilestoneInput, zonedLocalDateTimeToUtc, type TransactionMilestone } from './operational-signal';

const BASE: TransactionMilestone = {
  id: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  transactionId: '00000000-0000-4000-8000-000000000003', contactId: '00000000-0000-4000-8000-000000000004',
  contactName: 'Morgan Ellis', propertyAddress: '1 Main Street', potentialValueCents: 900000, kind: 'inspection', label: 'Inspection period',
  state: 'open', dueAt: '2026-08-20T16:00:00.000Z', timezone: 'America/New_York', responsibleMembershipId: '00000000-0000-4000-8000-000000000005', source: 'manual', sourceType: 'contract', sourceReference: 'Contract section 12', sourceDate: '2026-08-01', verificationState: 'verified', currentVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('operational signals', () => {
  it('normalizes a real transaction deadline', () => {
    expect(validateTransactionMilestoneInput({ transactionId: BASE.transactionId, kind: 'title', label: '  Title   commitment ', dueAt: '2026-09-01T12:00:00Z', timezone: BASE.timezone, responsibleMembershipId: BASE.responsibleMembershipId, sourceType: 'title', sourceReference: 'Title commitment', sourceDate: '2026-08-29', verificationState: 'verified', idempotencyKey: BASE.id }).label).toBe('Title commitment');
  });
  it('computes overdue days only for open milestones', () => {
    expect(milestoneDaysOverdue(BASE, new Date('2026-08-23T16:00:00Z'))).toBe(3);
    expect(milestoneDaysOverdue({ ...BASE, state: 'completed' }, new Date('2026-08-23T16:00:00Z'))).toBe(0);
  });
  it('orders equal-priority deadlines FIFO', () => {
    expect(compareOperationalDeadline(BASE, { ...BASE, id: '00000000-0000-4000-8000-000000000009', dueAt: '2026-08-21T00:00:00Z' })).toBeLessThan(0);
  });
  it('converts Florida wall time through DST and rejects the missing spring-forward hour', () => {
    expect(zonedLocalDateTimeToUtc('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
    expect(zonedLocalDateTimeToUtc('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z');
    expect(() => zonedLocalDateTimeToUtc('2026-03-08T02:30', 'America/New_York')).toThrow(/daylight saving/i);
  });
});
