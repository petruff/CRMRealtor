export const TRANSACTION_MILESTONE_KINDS = [
  'inspection', 'financing', 'appraisal', 'title', 'contingency', 'closing', 'custom',
] as const;
export type TransactionMilestoneKind = (typeof TRANSACTION_MILESTONE_KINDS)[number];

export const TRANSACTION_MILESTONE_STATES = ['open', 'completed', 'waived', 'cancelled'] as const;
export type TransactionMilestoneState = (typeof TRANSACTION_MILESTONE_STATES)[number];

export interface InboundResponseSignal {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly activityEventId: string;
  readonly contactName: string;
  readonly resourceHash: string;
  readonly receivedAt: string;
  readonly intelligenceState: 'pending' | 'classified' | 'guard-refused' | 'budget-unavailable' | 'provider-failed' | 'invalid-response';
  readonly intent?: string;
  readonly sentiment?: string;
  readonly urgency?: string;
  readonly summary?: string;
  readonly unknowns: readonly string[];
  readonly analyzedAt?: string;
  readonly acknowledgedAt?: string;
  readonly createdAt: string;
}

export interface TransactionMilestone {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly contactId: string;
  readonly contactName: string;
  readonly propertyAddress: string;
  readonly potentialValueCents: number;
  readonly kind: TransactionMilestoneKind;
  readonly label: string;
  readonly state: TransactionMilestoneState;
  readonly dueAt: string;
  readonly responsibleMembershipId: string;
  readonly source: 'manual' | 'transaction-expected-close';
  readonly currentVersion: number;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTransactionMilestoneInput {
  readonly transactionId: string;
  readonly kind: TransactionMilestoneKind;
  readonly label: string;
  readonly dueAt: string;
  readonly idempotencyKey: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

function instant(value: string, label: string): string {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed.toISOString();
}

export function validateTransactionMilestoneInput(input: CreateTransactionMilestoneInput): CreateTransactionMilestoneInput {
  if (!UUID.test(input.transactionId)) throw new Error('Choose a valid transaction.');
  if (!TRANSACTION_MILESTONE_KINDS.includes(input.kind)) throw new Error('Choose a valid deadline type.');
  const label = input.label.trim().replace(/\s+/g, ' ');
  if (!label || label.length > 120 || CONTROL.test(label)) throw new Error('Deadline name is invalid.');
  if (!UUID.test(input.idempotencyKey)) throw new Error('This deadline form expired. Refresh and try again.');
  return Object.freeze({ ...input, label, dueAt: instant(input.dueAt, 'Deadline') });
}

export function milestoneDaysOverdue(milestone: TransactionMilestone, now: Date): number {
  if (milestone.state !== 'open') return 0;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(milestone.dueAt)) / 86_400_000));
}

export function compareOperationalDeadline(left: TransactionMilestone, right: TransactionMilestone): number {
  return left.dueAt.localeCompare(right.dueAt) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
