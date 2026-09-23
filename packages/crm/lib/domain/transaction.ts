import type { LeadSource } from './contact.ts';

export const TRANSACTION_STATUSES = ['pending', 'under-contract', 'closed', 'lost', 'cancelled'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export const TRANSACTION_SIDES = ['buyer', 'seller', 'dual', 'referral'] as const;
export type TransactionSide = (typeof TRANSACTION_SIDES)[number];
export const TRANSACTION_KINDS = ['buyer', 'seller', 'listing', 'lease', 'referral'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type StoredTransactionKind = TransactionKind | 'unclassified';
export const TRANSACTION_PARTY_ROLES = [
  'client', 'co-client', 'buyer', 'seller', 'tenant', 'landlord',
  'referring-agent', 'cooperating-agent', 'lender', 'title', 'attorney', 'other',
] as const;
export type TransactionPartyRole = (typeof TRANSACTION_PARTY_ROLES)[number];

export interface RealEstateTransaction {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly kind: StoredTransactionKind;
  readonly kindVerified: boolean;
  readonly title: string;
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
  readonly responsibleMembershipId: string;
  readonly nextAction?: string;
  readonly nextActionDueAt?: string;
  readonly version: number;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRealEstateTransactionInput {
  readonly contactId: string;
  readonly kind: TransactionKind;
  readonly title: string;
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
  readonly nextAction?: string;
  readonly nextActionDueAt?: string;
  readonly idempotencyKey: string;
}

export interface TransactionParty {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly contactId?: string;
  readonly role: TransactionPartyRole;
  readonly displayLabel: string;
  readonly participatesInCommunication: boolean;
  readonly version: number;
  readonly archivedAt?: string;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AddTransactionPartyInput {
  readonly transactionId: string;
  readonly contactId?: string;
  readonly role: TransactionPartyRole;
  readonly displayLabel: string;
  readonly participatesInCommunication: boolean;
  readonly idempotencyKey: string;
}

export interface UpdateTransactionPartyInput {
  readonly partyId: string;
  readonly expectedVersion: number;
  readonly role: TransactionPartyRole;
  readonly displayLabel: string;
  readonly participatesInCommunication: boolean;
  readonly idempotencyKey: string;
}

export interface ArchiveTransactionPartyInput {
  readonly partyId: string;
  readonly expectedVersion: number;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface UpdateRealEstateTransactionInput {
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly kind: TransactionKind;
  readonly title: string;
  readonly side: TransactionSide;
  readonly propertyAddress: string;
  readonly expectedCloseDate?: string;
  readonly salePriceCents: number;
  readonly grossCommissionCents: number;
  readonly netCommissionCents: number;
  readonly marketingCostCents: number;
  readonly expenseCents: number;
  readonly nextAction?: string;
  readonly nextActionDueAt?: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface TransitionRealEstateTransactionInput {
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly status: TransactionStatus;
  readonly closedAt?: string;
  readonly reasonCode: string;
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

function validCalendarDate(value: string | undefined): boolean {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3]);
}

function validInstant(value: string | undefined): boolean {
  return value === undefined || (!Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value);
}

function uuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return value;
}

export function validateTransactionInput(input: CreateRealEstateTransactionInput): CreateRealEstateTransactionInput {
  if (!/^[0-9a-f-]{36}$/i.test(input.contactId)) throw new Error('Choose a valid contact.');
  if (!TRANSACTION_KINDS.includes(input.kind)) throw new Error('Choose a valid transaction type.');
  if (!TRANSACTION_STATUSES.includes(input.status)) throw new Error('Choose a valid transaction status.');
  if (!TRANSACTION_SIDES.includes(input.side)) throw new Error('Choose a valid representation side.');
  const propertyAddress = input.propertyAddress.trim().replace(/\s+/g, ' ').slice(0, 240);
  const title = input.title.trim().replace(/\s+/g, ' ').slice(0, 120);
  const nextAction = input.nextAction?.trim().replace(/\s+/g, ' ').slice(0, 200) || undefined;
  if (!title) throw new Error('Transaction title is required.');
  if (!propertyAddress) throw new Error('Property address is required.');
  if (input.status === 'closed' && !input.closedAt) throw new Error('Closed date is required for a closed transaction.');
  if (!validCalendarDate(input.expectedCloseDate)) throw new Error('Expected close date must be a valid date.');
  if (!validCalendarDate(input.closedAt)) throw new Error('Closed date must be a valid date.');
  if (!validInstant(input.nextActionDueAt)) throw new Error('Next action due time must be a valid UTC timestamp.');
  if (input.nextActionDueAt && !nextAction) throw new Error('Next action is required when a due time is provided.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new Error('Transaction idempotency key must be a valid UUID.');
  }
  return {
    ...input,
    title,
    propertyAddress,
    nextAction,
    salePriceCents: cents(input.salePriceCents, 'Sale price'),
    grossCommissionCents: cents(input.grossCommissionCents, 'GCI'),
    netCommissionCents: cents(input.netCommissionCents, 'Net commission'),
    marketingCostCents: cents(input.marketingCostCents, 'Marketing cost'),
    expenseCents: cents(input.expenseCents, 'Other expenses'),
  };
}

export function validateTransactionPartyInput(input: AddTransactionPartyInput): AddTransactionPartyInput {
  uuid(input.transactionId, 'Transaction');
  if (input.contactId) uuid(input.contactId, 'Party contact');
  if (!TRANSACTION_PARTY_ROLES.includes(input.role)) throw new Error('Choose a valid party role.');
  const displayLabel = input.displayLabel.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!displayLabel) throw new Error('Party name or label is required.');
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 160) throw new Error('Party idempotency key is invalid.');
  return { ...input, displayLabel };
}

function version(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} version is invalid.`);
  return value;
}

function idempotencyKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) throw new Error(`${label} idempotency key is invalid.`);
  return normalized;
}

function reasonCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!normalized) throw new Error('Transaction change reason is required.');
  return normalized;
}

export function validateTransactionPartyUpdate(input: UpdateTransactionPartyInput): UpdateTransactionPartyInput {
  uuid(input.partyId, 'Transaction party');
  version(input.expectedVersion, 'Transaction party');
  if (!TRANSACTION_PARTY_ROLES.includes(input.role)) throw new Error('Choose a valid party role.');
  const displayLabel = input.displayLabel.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!displayLabel) throw new Error('Party name or label is required.');
  return { ...input, displayLabel, idempotencyKey: idempotencyKey(input.idempotencyKey, 'Party') };
}

export function validateTransactionPartyArchive(input: ArchiveTransactionPartyInput): ArchiveTransactionPartyInput {
  uuid(input.partyId, 'Transaction party');
  version(input.expectedVersion, 'Transaction party');
  return {
    ...input,
    reasonCode: reasonCode(input.reasonCode),
    idempotencyKey: idempotencyKey(input.idempotencyKey, 'Party'),
  };
}

export function validateTransactionUpdate(input: UpdateRealEstateTransactionInput): UpdateRealEstateTransactionInput {
  uuid(input.transactionId, 'Transaction');
  version(input.expectedVersion, 'Transaction');
  if (!TRANSACTION_KINDS.includes(input.kind)) throw new Error('Choose a valid transaction type.');
  if (!TRANSACTION_SIDES.includes(input.side)) throw new Error('Choose a valid representation side.');
  const title = input.title.trim().replace(/\s+/g, ' ').slice(0, 120);
  const propertyAddress = input.propertyAddress.trim().replace(/\s+/g, ' ').slice(0, 240);
  const nextAction = input.nextAction?.trim().replace(/\s+/g, ' ').slice(0, 200) || undefined;
  if (!title) throw new Error('Transaction title is required.');
  if (!propertyAddress) throw new Error('Property address is required.');
  if (!validCalendarDate(input.expectedCloseDate)) throw new Error('Expected close date must be a valid date.');
  if (!validInstant(input.nextActionDueAt)) throw new Error('Next action due time must be a valid UTC timestamp.');
  if (input.nextActionDueAt && !nextAction) throw new Error('Next action is required when a due time is provided.');
  return {
    ...input,
    title,
    propertyAddress,
    nextAction,
    reasonCode: reasonCode(input.reasonCode),
    idempotencyKey: idempotencyKey(input.idempotencyKey, 'Transaction'),
    salePriceCents: cents(input.salePriceCents, 'Sale price'),
    grossCommissionCents: cents(input.grossCommissionCents, 'GCI'),
    netCommissionCents: cents(input.netCommissionCents, 'Net commission'),
    marketingCostCents: cents(input.marketingCostCents, 'Marketing cost'),
    expenseCents: cents(input.expenseCents, 'Other expenses'),
  };
}

export function validateTransactionTransition(input: TransitionRealEstateTransactionInput): TransitionRealEstateTransactionInput {
  uuid(input.transactionId, 'Transaction');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('Transaction version is invalid.');
  if (!TRANSACTION_STATUSES.includes(input.status)) throw new Error('Choose a valid transaction status.');
  if (!validCalendarDate(input.closedAt)) throw new Error('Closed date must be a valid date.');
  if (input.status === 'closed' && !input.closedAt) throw new Error('Closed date is required for a closed transaction.');
  return {
    ...input,
    reasonCode: reasonCode(input.reasonCode),
    idempotencyKey: idempotencyKey(input.idempotencyKey, 'Transaction'),
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
