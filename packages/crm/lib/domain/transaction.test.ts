import { describe, expect, it } from 'vitest';
import { calculateTransactionMetrics, validateTransactionInput, validateTransactionPartyArchive, validateTransactionPartyInput, validateTransactionPartyUpdate, validateTransactionTransition, validateTransactionUpdate, type RealEstateTransaction } from './transaction';

const BASE: RealEstateTransaction = {
  id: 'transaction-1', workspaceId: 'workspace-1', contactId: 'contact-1', contactName: 'Avery Stone',
  kind: 'buyer', kindVerified: true, title: 'Avery purchase',
  status: 'closed', side: 'buyer', propertyAddress: '1 Main Street', source: 'referral',
  closedAt: '2026-08-10', salePriceCents: 50000000, grossCommissionCents: 1500000,
  netCommissionCents: 900000, marketingCostCents: 100000, expenseCents: 50000,
  responsibleMembershipId: 'membership-1', version: 1, createdByMembershipId: 'membership-1',
  createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z',
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
      kind: 'seller' as const, title: 'Lake Road listing',
      propertyAddress: '  10   Lake Road ', closedAt: '2026-08-24', salePriceCents: 1,
      grossCommissionCents: 1, netCommissionCents: 1, marketingCostCents: 0, expenseCents: 0,
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
    };
    expect(validateTransactionInput(valid).propertyAddress).toBe('10 Lake Road');
    expect(() => validateTransactionInput({ ...valid, closedAt: undefined })).toThrow(/Closed date/);
    expect(() => validateTransactionInput({ ...valid, closedAt: '2026-02-31' })).toThrow(/valid date/);
    expect(() => validateTransactionInput({ ...valid, idempotencyKey: 'not-a-uuid' })).toThrow(/valid UUID/);
    expect(() => validateTransactionInput({ ...valid, expenseCents: -1 })).toThrow(/non-negative/);
    expect(() => validateTransactionInput({ ...valid, kind: 'unclassified' as never })).toThrow(/transaction type/);
    expect(() => validateTransactionInput({ ...valid, title: '   ' })).toThrow(/title/);
    expect(() => validateTransactionInput({ ...valid, nextActionDueAt: '2026-08-25T12:00:00.000Z' })).toThrow(/Next action is required/);
  });

  it('bounds party identity and versioned transaction transitions', () => {
    expect(validateTransactionPartyInput({
      transactionId: '00000000-0000-4000-8000-000000000001', role: 'lender',
      displayLabel: '  Trusted   Lending  ', participatesInCommunication: false,
      idempotencyKey: 'transaction-party:test',
    }).displayLabel).toBe('Trusted Lending');
    expect(() => validateTransactionPartyInput({
      transactionId: 'invalid', role: 'other', displayLabel: 'Person',
      participatesInCommunication: false, idempotencyKey: 'test',
    })).toThrow(/valid UUID/);
    expect(validateTransactionTransition({
      transactionId: '00000000-0000-4000-8000-000000000001', expectedVersion: 2,
      status: 'closed', closedAt: '2026-09-30', reasonCode: ' Closing confirmed ',
      idempotencyKey: 'transaction-transition:test',
    }).reasonCode).toBe('closing-confirmed');
    expect(() => validateTransactionTransition({
      transactionId: '00000000-0000-4000-8000-000000000001', expectedVersion: 1,
      status: 'closed', reasonCode: 'closed', idempotencyKey: 'transaction-transition:test',
    })).toThrow(/Closed date/);
  });

  it('validates versioned detail and party maintenance without inferring identity', () => {
    const updated = validateTransactionUpdate({
      transactionId: '00000000-0000-4000-8000-000000000001', expectedVersion: 3,
      kind: 'listing', title: '  Ocean   listing ', side: 'seller', propertyAddress: ' 8 Ocean Drive ',
      salePriceCents: 90000000, grossCommissionCents: 2700000, netCommissionCents: 1600000,
      marketingCostCents: 125000, expenseCents: 25000, nextAction: ' Confirm photos ',
      nextActionDueAt: '2026-09-02T14:00:00.000Z', reasonCode: 'Realtor edit', idempotencyKey: 'transaction:update:3',
    });
    expect(updated).toMatchObject({ title: 'Ocean listing', propertyAddress: '8 Ocean Drive', reasonCode: 'realtor-edit' });
    expect(validateTransactionPartyUpdate({
      partyId: '00000000-0000-4000-8000-000000000002', expectedVersion: 1, role: 'title',
      displayLabel: '  Treasure   Coast Title ', participatesInCommunication: true, idempotencyKey: 'party:update:1',
    }).displayLabel).toBe('Treasure Coast Title');
    expect(validateTransactionPartyArchive({
      partyId: '00000000-0000-4000-8000-000000000002', expectedVersion: 2,
      reasonCode: 'Removed by realtor', idempotencyKey: 'party:archive:2',
    }).reasonCode).toBe('removed-by-realtor');
    expect(() => validateTransactionUpdate({ ...updated, expectedVersion: 0 })).toThrow(/version/);
  });
});
