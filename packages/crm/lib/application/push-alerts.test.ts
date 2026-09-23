import { describe, expect, it } from 'vitest';
import type { TransactionMilestone } from '../domain/operational-signal.ts';
import { deadlineLine, inQuietHours, newLeadAlert, newLeadsAlert, urgentDeadlines } from './push-alerts.ts';

const tz = 'America/New_York';
const at = (iso: string) => new Date(iso);

describe('quiet hours', () => {
  it('wraps midnight and treats equal hours as never quiet', () => {
    expect(inQuietHours(at('2026-09-24T02:30:00Z'), tz, 21, 7)).toBe(true); // 10:30 PM ET
    expect(inQuietHours(at('2026-09-24T10:30:00Z'), tz, 21, 7)).toBe(true); // 6:30 AM ET
    expect(inQuietHours(at('2026-09-24T11:30:00Z'), tz, 21, 7)).toBe(false); // 7:30 AM ET
    expect(inQuietHours(at('2026-09-24T16:00:00Z'), tz, 12, 14)).toBe(true); // noon ET
    expect(inQuietHours(at('2026-09-24T16:00:00Z'), tz, 9, 9)).toBe(false);
  });
});

describe('new lead alerts', () => {
  it('keeps names off the lock screen unless allowed', () => {
    const lead = { contactId: 'c 1', firstName: 'Ana', lastName: 'Cruz', source: 'zillow' };
    expect(newLeadAlert(lead, false)).toEqual({ title: 'New lead waiting', body: 'From Zillow. The first agent to call usually wins — tap to open and call.', url: '/contacts/c%201', tag: 'omnix-new-lead-c 1' });
    expect(newLeadAlert(lead, true).title).toBe('New lead: Ana Cruz');
  });

  it('summarizes several leads into one notification', () => {
    expect(newLeadsAlert([], true)).toBeUndefined();
    expect(newLeadsAlert([{ contactId: 'a' }, { contactId: 'b' }], true)).toMatchObject({ title: '2 new leads waiting', url: '/contacts?scope=leads' });
  });
});

function milestone(patch: Partial<TransactionMilestone>): TransactionMilestone {
  return {
    id: 'm', workspaceId: 'w', transactionId: 't', contactId: 'c', contactName: 'Ana', propertyAddress: '1408 Bayshore Dr', potentialValueCents: 0,
    kind: 'inspection', label: 'Inspection period ends', state: 'open', dueAt: '2026-09-25T03:59:00.000Z', timezone: tz, responsibleMembershipId: 'm',
    source: 'manual', sourceType: 'contract', sourceReference: 'FR/BAR', sourceDate: '2026-09-10', verificationState: 'verified', currentVersion: 1,
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', ...patch,
  };
}

describe('urgent deadlines', () => {
  const now = at('2026-09-23T11:00:00Z'); // 7 AM ET, Sep 23
  it('keeps overdue, today and tomorrow, soonest first', () => {
    const list = urgentDeadlines([
      milestone({ id: '1', label: 'Closing', dueAt: '2026-10-16T14:00:00.000Z' }),
      milestone({ id: '2', label: 'Loan approval', dueAt: '2026-09-24T21:00:00.000Z' }),
      milestone({ id: '3', label: 'Escrow deposit', dueAt: '2026-09-22T21:00:00.000Z' }),
      milestone({ id: '4', label: 'Inspection period ends', dueAt: '2026-09-24T03:59:00.000Z' }),
      milestone({ id: '5', label: 'Done', dueAt: '2026-09-23T15:00:00.000Z', state: 'completed' }),
    ], now, tz);
    expect(list.map((item) => [item.label, item.when])).toEqual([
      ['Escrow deposit', 'overdue'], ['Inspection period ends', 'today'], ['Loan approval', 'tomorrow'],
    ]);
  });

  it('describes them without addresses unless names are allowed', () => {
    const list = [{ label: 'Inspection period ends', propertyAddress: '1408 Bayshore Dr', when: 'tomorrow' as const }];
    expect(deadlineLine(list, true)).toBe('Inspection period ends — due tomorrow (1408 Bayshore Dr).');
    expect(deadlineLine(list, false)).toBe('1 deal date in the next 48 hours.');
    expect(deadlineLine([], false)).toBeUndefined();
  });
});
