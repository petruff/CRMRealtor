import type { TransactionMilestone } from './operational-signal.ts';
import type { RealEstateTransaction } from './transaction.ts';

/**
 * Florida deal readiness: two disclosures a Florida realtor must be able to
 * prove, derived only from sourced milestones already on the deal. This is an
 * operational reminder, never a legal conclusion — Omnix does not judge the
 * sufficiency of a document, only whether the realtor recorded one.
 */

export type ReadinessKey = 'buyer-agreement' | 'flood-disclosure';
export type ReadinessState = 'on-file' | 'waived' | 'scheduled' | 'missing';
export type ReadinessTone = 'ok' | 'attention' | 'urgent';

export interface ReadinessCheck {
  readonly key: ReadinessKey;
  readonly transactionId: string;
  readonly title: string;
  readonly state: ReadinessState;
  readonly tone: ReadinessTone;
  readonly detail: string;
  readonly sourceUrl: string;
  readonly milestoneKind: 'buyer-agreement' | 'flood';
  readonly evidence?: string;
}

export const READINESS_BOUNDARY = 'Operational reminder only — not legal advice. Follow your brokerage’s forms and counsel.';

interface Definition {
  readonly title: string;
  readonly milestoneKind: 'buyer-agreement' | 'flood';
  readonly sourceUrl: string;
  readonly missingPending: string;
  readonly missingUnderContract: string;
  readonly label: string;
}

export const READINESS_DEFINITIONS: Readonly<Record<ReadinessKey, Definition>> = {
  'buyer-agreement': {
    title: 'Written buyer agreement',
    milestoneKind: 'buyer-agreement',
    sourceUrl: 'https://www.nar.realtor/the-facts',
    missingPending: 'Needed before you tour homes together.',
    missingUnderContract: 'Not on file — record the signed agreement before closing paperwork.',
    label: 'Written buyer agreement signed',
  },
  'flood-disclosure': {
    title: 'Seller flood disclosure',
    milestoneKind: 'flood',
    sourceUrl: 'https://www.flsenate.gov/laws/statutes/2024/689.302',
    missingPending: 'Deliver it to the buyer at or before contract signing (Fla. Stat. § 689.302).',
    missingUnderContract: 'Not on file — the buyer should have received it at or before contract.',
    label: 'Flood disclosure delivered to buyer',
  },
};

const ACTIVE = new Set(['pending', 'under-contract']);
const SALE_KINDS = new Set(['buyer', 'seller', 'listing', 'unclassified']);

export function readinessKeysFor(transaction: Pick<RealEstateTransaction, 'side' | 'kind' | 'status'>): ReadinessKey[] {
  if (!ACTIVE.has(transaction.status) || !SALE_KINDS.has(transaction.kind)) return [];
  const keys: ReadinessKey[] = [];
  const buyerSide = transaction.side === 'buyer' || transaction.side === 'dual';
  const sellerSide = transaction.side === 'seller' || transaction.side === 'dual';
  if (buyerSide) keys.push('buyer-agreement');
  if (sellerSide || transaction.kind === 'listing' || transaction.kind === 'seller') keys.push('flood-disclosure');
  return Array.from(new Set(keys));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}

export function dealReadiness(
  transaction: Pick<RealEstateTransaction, 'id' | 'side' | 'kind' | 'status'>,
  milestones: readonly TransactionMilestone[],
  now: Date,
): ReadinessCheck[] {
  return readinessKeysFor(transaction).map((key): ReadinessCheck => {
    const definition = READINESS_DEFINITIONS[key];
    const related = milestones
      .filter((item) => item.transactionId === transaction.id && item.kind === definition.milestoneKind && item.state !== 'cancelled')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const base = { key, transactionId: transaction.id, title: definition.title, sourceUrl: definition.sourceUrl, milestoneKind: definition.milestoneKind };
    const done = related.find((item) => item.state === 'completed');
    if (done) {
      return {
        ...base, state: 'on-file', tone: 'ok',
        detail: `On file${done.completedAt ? ` · ${shortDate(done.completedAt)}` : ''}${done.verificationState === 'verified' ? '' : ' · not verified'}`,
        evidence: done.sourceReference,
      };
    }
    const waived = related.find((item) => item.state === 'waived');
    if (waived) return { ...base, state: 'waived', tone: 'ok', detail: 'Marked not applicable', evidence: waived.sourceReference };
    const open = related.find((item) => item.state === 'open');
    if (open) {
      const late = Date.parse(open.dueAt) < now.getTime();
      return { ...base, state: 'scheduled', tone: late ? 'urgent' : 'attention', detail: late ? `Overdue since ${shortDate(open.dueAt)}` : `Due ${shortDate(open.dueAt)}` };
    }
    const underContract = transaction.status === 'under-contract';
    return {
      ...base, state: 'missing', tone: underContract ? 'urgent' : 'attention',
      detail: underContract ? definition.missingUnderContract : definition.missingPending,
    };
  });
}

export interface ReadinessGap extends ReadinessCheck {
  readonly transactionTitle: string;
  readonly contactId: string;
}

/** Every open readiness item across active deals, most urgent first. */
export function readinessGaps(
  transactions: readonly RealEstateTransaction[],
  milestones: readonly TransactionMilestone[],
  now: Date,
): ReadinessGap[] {
  return transactions
    .flatMap((transaction) => dealReadiness(transaction, milestones, now)
      .filter((check) => check.tone !== 'ok')
      .map((check) => ({ ...check, transactionTitle: transaction.title, contactId: transaction.contactId })))
    .sort((left, right) => Number(right.tone === 'urgent') - Number(left.tone === 'urgent'));
}
