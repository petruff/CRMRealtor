import type { LeadSource } from './contact.ts';

export const TRANSACTION_STATUSES = ['pending', 'under-contract', 'closed', 'lost', 'cancelled'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const TRANSACTION_SIDES = ['buyer', 'seller', 'dual', 'referral'] as const;
export type TransactionSide = (typeof TRANSACTION_SIDES)[number];

export interface RealEstateTransaction {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly status: TransactionStatus;
  readonly side: TransactionSide;
  readonly propertyAddress: string;
  readonly source: LeadSource;
  readonly expectedCloseDate?: string;
  readonly closedAt?: string;
  readonly salePriceCents: number;
  readonly grossCommissionCents: number;
  readonly netCommissionCents: number;
  readonly marketingCostCents: number;
  readonly expenseCents: number;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRealEstateTransactionInput {
  readonly contactId: string;
  readonly status: TransactionStatus;
  readonly side: TransactionSide;
  readonly propertyAddress: string;
  readonly expectedCloseDate?: string;
  readonly closedAt?: string;
  readonly salePriceCents: number;
  readonly grossCommissionCents: number;
  readonly netCommissionCents: number;
  readonly marketingCostCents: number;
  readonly expenseCents: number;
  readonly idempotencyKey: string;
}

export interface TransactionSourceMetric {
  readonly source: LeadSource;
  readonly deals: number;
  readonly volumeCents: number;
  readonly netIncomeCents: number;
  readonly marketingCostCents: number;
  readonly roiPercentage: number | null;
}

export interface TransactionMetrics {
  readonly closedDeals: number;
  readonly closedVolumeCents: number;
  readonly grossCommissionCents: number;
  readonly netCommissionCents: number;
  readonly trackedExpensesCents: number;
  readonly netIncomeCents: number;
  readonly activeForecastGciCents: number;
  readonly averageSalePriceCents: number | null;
  readonly sourceMetrics: readonly TransactionSourceMetric[];
}

function cents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative cent amount.`);
  return value;
}

export function validateTransactionInput(input: CreateRealEstateTransactionInput): CreateRealEstateTransactionInput {
  if (!/^[0-9a-f-]{36}$/i.test(input.contactId)) throw new Error('Choose a valid contact.');
  if (!TRANSACTION_STATUSES.includes(input.status)) throw new Error('Choose a valid transaction status.');
  if (!TRANSACTION_SIDES.includes(input.side)) throw new Error('Choose a valid representation side.');
  const propertyAddress = input.propertyAddress.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!propertyAddress) throw new Error('Property address is required.');
  if (input.status === 'closed' && !input.closedAt) throw new Error('Closed date is required for a closed transaction.');
  return {
    ...input,
    propertyAddress,
    salePriceCents: cents(input.salePriceCents, 'Sale price'),
    grossCommissionCents: cents(input.grossCommissionCents, 'GCI'),
    netCommissionCents: cents(input.netCommissionCents, 'Net commission'),
    marketingCostCents: cents(input.marketingCostCents, 'Marketing cost'),
    expenseCents: cents(input.expenseCents, 'Other expenses'),
  };
}

export function calculateTransactionMetrics(
  transactions: readonly RealEstateTransaction[],
  from: string,
  to: string,
): TransactionMetrics {
  const closed = transactions.filter((transaction) => transaction.status === 'closed'
    && transaction.closedAt !== undefined && transaction.closedAt >= from && transaction.closedAt <= to);
  const active = transactions.filter((transaction) => transaction.status === 'pending' || transaction.status === 'under-contract');
  const sum = (selector: (transaction: RealEstateTransaction) => number) => closed.reduce((total, transaction) => total + selector(transaction), 0);
  const sourceGroups = new Map<LeadSource, RealEstateTransaction[]>();
  for (const transaction of closed) sourceGroups.set(transaction.source, [...(sourceGroups.get(transaction.source) ?? []), transaction]);
  const sourceMetrics = [...sourceGroups.entries()].map(([source, rows]) => {
    const volumeCents = rows.reduce((total, row) => total + row.salePriceCents, 0);
    const marketingCostCents = rows.reduce((total, row) => total + row.marketingCostCents, 0);
    const netIncomeCents = rows.reduce((total, row) => total + row.netCommissionCents - row.marketingCostCents - row.expenseCents, 0);
    return {
      source, deals: rows.length, volumeCents, netIncomeCents, marketingCostCents,
      roiPercentage: marketingCostCents === 0 ? null : Math.round((netIncomeCents / marketingCostCents) * 1_000) / 10,
    };
  }).sort((left, right) => right.netIncomeCents - left.netIncomeCents || left.source.localeCompare(right.source));
  const closedVolumeCents = sum((transaction) => transaction.salePriceCents);
  const netCommissionCents = sum((transaction) => transaction.netCommissionCents);
  const trackedExpensesCents = sum((transaction) => transaction.marketingCostCents + transaction.expenseCents);
  return {
    closedDeals: closed.length,
    closedVolumeCents,
    grossCommissionCents: sum((transaction) => transaction.grossCommissionCents),
    netCommissionCents,
    trackedExpensesCents,
    netIncomeCents: netCommissionCents - trackedExpensesCents,
    activeForecastGciCents: active.reduce((total, transaction) => total + transaction.grossCommissionCents, 0),
    averageSalePriceCents: closed.length ? Math.round(closedVolumeCents / closed.length) : null,
    sourceMetrics,
  };
}
