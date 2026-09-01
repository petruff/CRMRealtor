import { describe, expect, it } from 'vitest';
import type { RealEstateTransaction } from './transaction';
import { calculateFinancialPortfolioMetrics, financialCompleteness, validateFinancialAuthorityInput, type TransactionFinancialAuthority } from './transaction-finance';

const TRANSACTION: RealEstateTransaction = {
  id: '00000000-0000-4000-8000-000000000071', workspaceId: 'workspace', contactId: 'contact', contactName: 'Avery',
  kind: 'buyer', kindVerified: true, title: 'Avery purchase', status: 'closed', side: 'buyer', propertyAddress: '1 Main',
  source: 'referral', closedAt: '2026-08-20', salePriceCents: 0, grossCommissionCents: 0, netCommissionCents: 0,
  marketingCostCents: 0, expenseCents: 0, responsibleMembershipId: 'member', version: 1, createdByMembershipId: 'member',
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
};
const FINANCE: TransactionFinancialAuthority = {
  id: 'finance', workspaceId: 'workspace', transactionId: TRANSACTION.id, transactionValueCents: 50000000,
  volumeBasisCents: 50000000, grossCommissionCents: 1500000, brokerageSplitCents: 500000, referralFeeCents: 100000,
  netCommissionCents: 900000, marketingCostCents: 50000, otherExpenseCents: 25000, sourceType: 'closing-statement',
  sourceReference: 'Closing statement page 2', effectiveDate: '2026-08-20', verificationState: 'verified', version: 1,
  updatedByMembershipId: 'member', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
};

describe('transaction financial authority', () => {
  it('separates verified booked truth from active unweighted forecast and exclusions', () => {
    const active = { ...TRANSACTION, id: '00000000-0000-4000-8000-000000000072', status: 'under-contract' as const, closedAt: undefined };
    const lost = { ...TRANSACTION, id: '00000000-0000-4000-8000-000000000073', status: 'lost' as const };
    const metrics = calculateFinancialPortfolioMetrics([TRANSACTION, active, lost], [FINANCE, { ...FINANCE, id: 'active-finance', transactionId: active.id }], '2026-08-01', '2026-08-31');
    expect(metrics.booked).toEqual({ deals: 1, volumeCents: 50000000, gciCents: 1500000, netCommissionCents: 900000, expensesCents: 75000, netIncomeCents: 825000 });
    expect(metrics.activeForecast).toEqual({ deals: 1, gciCents: 1500000, assumption: 'unweighted-verified-gci' });
    expect(metrics.excluded.lostOrCancelled).toBe(1);
  });

  it('keeps missing and unverified values out of booked income instead of zero filling', () => {
    const incomplete = { ...FINANCE, netCommissionCents: undefined, verificationState: 'unverified' as const };
    expect(financialCompleteness(incomplete).missing).toContain('netCommissionCents');
    const metrics = calculateFinancialPortfolioMetrics([TRANSACTION], [incomplete], '2026-08-01', '2026-08-31');
    expect(metrics.booked.deals).toBe(0);
    expect(metrics.excluded).toMatchObject({ incomplete: 1, unverified: 1 });
  });

  it('validates money, dates, source evidence, version and idempotency', () => {
    const input = { transactionId: TRANSACTION.id, expectedVersion: 0, transactionValueCents: 1, sourceType: 'manual-record' as const,
      sourceReference: '  Owner ledger  ', effectiveDate: '2026-08-20', verificationState: 'verified' as const,
      reasonCode: 'Owner verified', idempotencyKey: 'finance:update:1' };
    expect(validateFinancialAuthorityInput(input)).toMatchObject({ sourceReference: 'Owner ledger', reasonCode: 'owner-verified' });
    expect(() => validateFinancialAuthorityInput({ ...input, transactionValueCents: -1 })).toThrow(/non-negative/);
    expect(() => validateFinancialAuthorityInput({ ...input, effectiveDate: '2026-02-30' })).toThrow(/valid date/);
    expect(() => validateFinancialAuthorityInput({ ...input, sourceReference: ' ' })).toThrow(/source reference/);
  });
});
