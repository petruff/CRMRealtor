import { describe, expect, it } from 'vitest';
import { dealReadiness, readinessGaps, readinessKeysFor } from './florida-readiness.ts';
import type { TransactionMilestone } from './operational-signal.ts';
import type { RealEstateTransaction } from './transaction.ts';

const NOW = new Date('2026-09-23T15:00:00.000Z');

function deal(overrides: Partial<RealEstateTransaction> = {}): RealEstateTransaction {
  return {
    id: 't-1', workspaceId: 'w', contactId: 'c-1', contactName: 'Avery Buyer', kind: 'buyer', kindVerified: true,
    title: 'Avery · 12 Palm Ave', status: 'pending', side: 'buyer', propertyAddress: '12 Palm Ave', source: 'referral',
    salePriceCents: 0, grossCommissionCents: 0, netCommissionCents: 0, marketingCostCents: 0, expenseCents: 0,
    responsibleMembershipId: 'm', version: 1, createdByMembershipId: 'm', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function milestone(overrides: Partial<TransactionMilestone>): TransactionMilestone {
  return {
    id: 'm-1', workspaceId: 'w', transactionId: 't-1', contactId: 'c-1', contactName: 'Avery', propertyAddress: '12 Palm Ave',
    potentialValueCents: 0, kind: 'buyer-agreement', label: 'Buyer agreement', state: 'open', dueAt: '2026-09-30T15:00:00.000Z',
    timezone: 'America/New_York', responsibleMembershipId: 'm', source: 'manual', sourceType: 'transaction-record',
    sourceReference: 'Dotloop', sourceDate: '2026-09-20', verificationState: 'verified', currentVersion: 1,
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('readinessKeysFor', () => {
  it('asks buyers for the agreement and sellers for the flood disclosure', () => {
    expect(readinessKeysFor(deal())).toEqual(['buyer-agreement']);
    expect(readinessKeysFor(deal({ side: 'seller', kind: 'listing' }))).toEqual(['flood-disclosure']);
    expect(readinessKeysFor(deal({ side: 'dual', kind: 'buyer' }))).toEqual(['buyer-agreement', 'flood-disclosure']);
    expect(readinessKeysFor(deal({ side: 'dual', kind: 'listing' }))).toEqual(['buyer-agreement', 'flood-disclosure']);
  });

  it('skips closed, lost, cancelled, lease and referral deals', () => {
    for (const status of ['closed', 'lost', 'cancelled'] as const) expect(readinessKeysFor(deal({ status }))).toEqual([]);
    expect(readinessKeysFor(deal({ kind: 'lease' }))).toEqual([]);
    expect(readinessKeysFor(deal({ kind: 'referral', side: 'referral' }))).toEqual([]);
  });
});

describe('dealReadiness', () => {
  it('flags a missing buyer agreement before touring, and as urgent once under contract', () => {
    expect(dealReadiness(deal(), [], NOW)[0]).toMatchObject({ state: 'missing', tone: 'attention', detail: 'Needed before you tour homes together.' });
    expect(dealReadiness(deal({ status: 'under-contract' }), [], NOW)[0]).toMatchObject({ state: 'missing', tone: 'urgent' });
  });

  it('treats a completed milestone as on file and shows its source', () => {
    const [check] = dealReadiness(deal(), [milestone({ state: 'completed', completedAt: '2026-09-21T12:00:00.000Z' })], NOW);
    expect(check).toMatchObject({ state: 'on-file', tone: 'ok', evidence: 'Dotloop' });
    expect(check?.detail).toBe('On file · Sep 21');
  });

  it('notes when the document on file was not verified', () => {
    const [check] = dealReadiness(deal(), [milestone({ state: 'completed', verificationState: 'unverified' })], NOW);
    expect(check?.detail).toContain('not verified');
  });

  it('uses the scheduled milestone due date, urgent when overdue', () => {
    expect(dealReadiness(deal(), [milestone({})], NOW)[0]).toMatchObject({ state: 'scheduled', tone: 'attention', detail: 'Due Sep 30' });
    expect(dealReadiness(deal(), [milestone({ dueAt: '2026-09-20T12:00:00.000Z' })], NOW)[0]).toMatchObject({ tone: 'urgent', detail: 'Overdue since Sep 20' });
  });

  it('accepts a waived item and ignores cancelled or other-deal milestones', () => {
    expect(dealReadiness(deal(), [milestone({ state: 'waived' })], NOW)[0]).toMatchObject({ state: 'waived', tone: 'ok' });
    expect(dealReadiness(deal(), [milestone({ state: 'cancelled' }), milestone({ transactionId: 'other', state: 'completed' })], NOW)[0])
      .toMatchObject({ state: 'missing' });
  });

  it('reads the flood disclosure from flood milestones', () => {
    const seller = deal({ side: 'seller', kind: 'seller' });
    expect(dealReadiness(seller, [milestone({ kind: 'flood', state: 'completed' })], NOW)[0]).toMatchObject({ key: 'flood-disclosure', state: 'on-file' });
  });
});

describe('readinessGaps', () => {
  it('lists open items across deals with urgent first', () => {
    const gaps = readinessGaps([deal(), deal({ id: 't-2', status: 'under-contract', side: 'seller', kind: 'listing', title: 'Listing' })], [], NOW);
    expect(gaps.map((gap) => [gap.transactionId, gap.tone])).toEqual([['t-2', 'urgent'], ['t-1', 'attention']]);
  });
});
