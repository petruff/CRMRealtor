import { describe, expect, it } from 'vitest';
import { calculateTransactionMetrics, validateTransactionInput, type RealEstateTransaction } from './transaction';

const BASE: RealEstateTransaction = {
  id: 'transaction-1', workspaceId: 'workspace-1', contactId: 'contact-1', contactName: 'Avery Stone',
  status: 'closed', side: 'buyer', propertyAddress: '1 Main Street', source: 'referral',
  closedAt: '2026-08-10', salePriceCents: 50000000, grossCommissionCents: 1500000,
  netCommissionCents: 900000, marketingCostCents: 100000, expenseCents: 50000,
  createdByMembershipId: 'membership-1', createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z',
};

describe('transaction intelligence', () => {
  it('uses only closed deals inside the selected period and explicit active GCI for forecast', () => {
    const metrics = calculateTransactionMetrics([
      BASE,
      { ...BASE, id: 'transaction-old', closedAt: '2025-01-01' },
      { ...BASE, id: 'transaction-active', status: 'under-contract', closedAt: undefined, grossCommissionCents: 600000 },
    ], '2026-05-01T00:00:00.000Z', '2026-08-24T23:59:59.999Z');
    expect(metrics).toMatchObject({
      closedDeals: 1, closedVolumeCents: 50000000, grossCommissionCents: 1500000,
      netCommissionCents: 900000, trackedExpensesCents: 150000, netIncomeCents: 750000,
      activeForecastGciCents: 600000, averageSalePriceCents: 50000000,
    });
    expect(metrics.sourceMetrics[0]).toMatchObject({ source: 'referral', roiPercentage: 750 });
  });

  it('requires a closed date and rejects negative or unsafe money', () => {
    const valid = {
      contactId: '00000000-0000-4000-8000-000000000001', status: 'closed' as const, side: 'seller' as const,
      propertyAddress: '  10   Lake Road ', closedAt: '2026-08-24', salePriceCents: 1,
      grossCommissionCents: 1, netCommissionCents: 1, marketingCostCents: 0, expenseCents: 0,
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
    };
    expect(validateTransactionInput(valid).propertyAddress).toBe('10 Lake Road');
    expect(() => validateTransactionInput({ ...valid, closedAt: undefined })).toThrow(/Closed date/);
    expect(() => validateTransactionInput({ ...valid, expenseCents: -1 })).toThrow(/non-negative/);
  });
});
