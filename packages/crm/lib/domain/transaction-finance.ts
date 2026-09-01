import type { LeadSource } from './contact';
import type { RealEstateTransaction } from './transaction';

export const FINANCIAL_SOURCE_TYPES = [
  'closing-statement', 'brokerage-statement', 'referral-agreement', 'expense-receipt', 'manual-record', 'legacy-transaction',
] as const;
export type FinancialSourceType = (typeof FINANCIAL_SOURCE_TYPES)[number];
export const FINANCIAL_VERIFICATION_STATES = ['unverified', 'verified', 'contradictory'] as const;
export type FinancialVerificationState = (typeof FINANCIAL_VERIFICATION_STATES)[number];
export const FINANCIAL_FIELDS = [
  'transactionValueCents', 'volumeBasisCents', 'grossCommissionCents', 'brokerageSplitCents',
  'referralFeeCents', 'netCommissionCents', 'marketingCostCents', 'otherExpenseCents',
] as const;
export type FinancialField = (typeof FINANCIAL_FIELDS)[number];

export interface TransactionFinancialAuthority {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly transactionValueCents?: number;
  readonly volumeBasisCents?: number;
  readonly grossCommissionCents?: number;
  readonly brokerageSplitCents?: number;
  readonly referralFeeCents?: number;
  readonly netCommissionCents?: number;
  readonly marketingCostCents?: number;
  readonly otherExpenseCents?: number;
  readonly sourceType: FinancialSourceType;
  readonly sourceReference: string;
  readonly effectiveDate: string;
  readonly verificationState: FinancialVerificationState;
  readonly version: number;
  readonly updatedByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertTransactionFinancialAuthorityInput {
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly transactionValueCents?: number;
  readonly volumeBasisCents?: number;
  readonly grossCommissionCents?: number;
  readonly brokerageSplitCents?: number;
  readonly referralFeeCents?: number;
  readonly netCommissionCents?: number;
  readonly marketingCostCents?: number;
  readonly otherExpenseCents?: number;
  readonly sourceType: FinancialSourceType;
  readonly sourceReference: string;
  readonly effectiveDate: string;
  readonly verificationState: Exclude<FinancialVerificationState, 'contradictory'>;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface FinancialCompleteness {
  readonly complete: boolean;
  readonly missing: readonly FinancialField[];
  readonly arithmeticDifferenceCents?: number;
}

export interface FinancialContributor {
  readonly transactionId: string;
  readonly transactionTitle: string;
  readonly source: LeadSource;
  readonly status: RealEstateTransaction['status'];
  readonly effectiveDate: string;
  readonly volumeCents?: number;
  readonly gciCents?: number;
  readonly netCommissionCents?: number;
  readonly expensesCents?: number;
  readonly netIncomeCents?: number;
  readonly verificationState: FinancialVerificationState;
  readonly missing: readonly FinancialField[];
}

export interface FinancialPortfolioMetrics {
  readonly booked: {
    readonly deals: number;
    readonly volumeCents: number;
    readonly gciCents: number;
    readonly netCommissionCents: number;
    readonly expensesCents: number;
    readonly netIncomeCents: number;
  };
  readonly activeForecast: { readonly deals: number; readonly gciCents: number; readonly assumption: 'unweighted-verified-gci' };
  readonly excluded: { readonly lostOrCancelled: number; readonly incomplete: number; readonly unverified: number; readonly contradictory: number };
  readonly contributors: readonly FinancialContributor[];
}

function calendarDate(value: string, label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} must be a valid date.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error(`${label} must be a valid date.`);
  }
  return value;
}

function optionalCents(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative cent amount.`);
  return value;
}

export function financialCompleteness(authority: TransactionFinancialAuthority): FinancialCompleteness {
  const missing = FINANCIAL_FIELDS.filter((field) => authority[field] === undefined);
  const hasArithmetic = authority.grossCommissionCents !== undefined && authority.brokerageSplitCents !== undefined
    && authority.referralFeeCents !== undefined && authority.netCommissionCents !== undefined;
  const arithmeticDifferenceCents = hasArithmetic
    ? authority.netCommissionCents! - (authority.grossCommissionCents! - authority.brokerageSplitCents! - authority.referralFeeCents!)
    : undefined;
  return { complete: missing.length === 0, missing, arithmeticDifferenceCents };
}

export function validateFinancialAuthorityInput(input: UpsertTransactionFinancialAuthorityInput): UpsertTransactionFinancialAuthorityInput {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.transactionId)) {
    throw new Error('Transaction must be a valid UUID.');
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error('Financial version is invalid.');
  if (!FINANCIAL_SOURCE_TYPES.includes(input.sourceType)) throw new Error('Choose a valid financial source type.');
  if (!FINANCIAL_VERIFICATION_STATES.includes(input.verificationState)) throw new Error('Choose a valid verification state.');
  const sourceReference = input.sourceReference.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!sourceReference) throw new Error('Financial source reference is required.');
  const reasonCode = input.reasonCode.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!reasonCode) throw new Error('Financial change reason is required.');
  const idempotencyKey = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(idempotencyKey)) throw new Error('Financial idempotency key is invalid.');
  return {
    ...input,
    sourceReference,
    effectiveDate: calendarDate(input.effectiveDate, 'Financial effective date'),
    reasonCode,
    idempotencyKey,
    transactionValueCents: optionalCents(input.transactionValueCents, 'Transaction value'),
    volumeBasisCents: optionalCents(input.volumeBasisCents, 'Volume basis'),
    grossCommissionCents: optionalCents(input.grossCommissionCents, 'GCI'),
    brokerageSplitCents: optionalCents(input.brokerageSplitCents, 'Brokerage split'),
    referralFeeCents: optionalCents(input.referralFeeCents, 'Referral fee'),
    netCommissionCents: optionalCents(input.netCommissionCents, 'Net commission'),
    marketingCostCents: optionalCents(input.marketingCostCents, 'Marketing cost'),
    otherExpenseCents: optionalCents(input.otherExpenseCents, 'Other expense'),
  };
}

export function calculateFinancialPortfolioMetrics(
  transactions: readonly RealEstateTransaction[],
  authorities: readonly TransactionFinancialAuthority[],
  from: string,
  to: string,
): FinancialPortfolioMetrics {
  const transactionById = new Map(transactions.map((item) => [item.id, item]));
  const contributors: FinancialContributor[] = [];
  let lostOrCancelled = 0; let incomplete = 0; let unverified = 0; let contradictory = 0;
  for (const transaction of transactions) if (transaction.status === 'lost' || transaction.status === 'cancelled') lostOrCancelled += 1;
  for (const authority of authorities) {
    const transaction = transactionById.get(authority.transactionId);
    if (!transaction) continue;
    const completeness = financialCompleteness(authority);
    if (!completeness.complete) incomplete += 1;
    if (authority.verificationState === 'unverified') unverified += 1;
    if (authority.verificationState === 'contradictory') contradictory += 1;
    const expensesCents = authority.marketingCostCents !== undefined && authority.otherExpenseCents !== undefined
      ? authority.marketingCostCents + authority.otherExpenseCents : undefined;
    contributors.push({
      transactionId: transaction.id, transactionTitle: transaction.title, source: transaction.source, status: transaction.status,
      effectiveDate: authority.effectiveDate, volumeCents: authority.volumeBasisCents, gciCents: authority.grossCommissionCents,
      netCommissionCents: authority.netCommissionCents, expensesCents,
      netIncomeCents: authority.netCommissionCents !== undefined && expensesCents !== undefined
        ? authority.netCommissionCents - expensesCents : undefined,
      verificationState: authority.verificationState, missing: completeness.missing,
    });
  }
  const bookedRows = contributors.filter((row) => row.status === 'closed' && row.effectiveDate >= from && row.effectiveDate <= to
    && row.verificationState === 'verified' && row.missing.length === 0);
  const activeRows = contributors.filter((row) => (row.status === 'pending' || row.status === 'under-contract')
    && row.verificationState === 'verified' && row.gciCents !== undefined);
  const sum = (rows: readonly FinancialContributor[], field: 'volumeCents'|'gciCents'|'netCommissionCents'|'expensesCents'|'netIncomeCents') =>
    rows.reduce((total, row) => total + (row[field] ?? 0), 0);
  return {
    booked: {
      deals: bookedRows.length, volumeCents: sum(bookedRows, 'volumeCents'), gciCents: sum(bookedRows, 'gciCents'),
      netCommissionCents: sum(bookedRows, 'netCommissionCents'), expensesCents: sum(bookedRows, 'expensesCents'),
      netIncomeCents: sum(bookedRows, 'netIncomeCents'),
    },
    activeForecast: { deals: activeRows.length, gciCents: sum(activeRows, 'gciCents'), assumption: 'unweighted-verified-gci' },
    excluded: { lostOrCancelled, incomplete, unverified, contradictory },
    contributors: contributors.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || a.transactionTitle.localeCompare(b.transactionTitle)),
  };
}
