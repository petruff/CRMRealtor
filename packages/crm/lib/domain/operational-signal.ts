export const TRANSACTION_MILESTONE_KINDS = [
  'inspection', 'financing', 'appraisal', 'title', 'contingency', 'association', 'flood', 'buyer-agreement', 'closing', 'custom',
] as const;
export type TransactionMilestoneKind = (typeof TRANSACTION_MILESTONE_KINDS)[number];

export const TRANSACTION_MILESTONE_STATES = ['open', 'completed', 'waived', 'cancelled'] as const;
export type TransactionMilestoneState = (typeof TRANSACTION_MILESTONE_STATES)[number];
export const TRANSACTION_MILESTONE_SOURCE_TYPES = [
  'contract', 'addendum', 'transaction-record', 'lender', 'title', 'association', 'insurance', 'manual-note',
] as const;
export type TransactionMilestoneSourceType = (typeof TRANSACTION_MILESTONE_SOURCE_TYPES)[number];
export const TRANSACTION_MILESTONE_VERIFICATION_STATES = ['unverified', 'verified', 'contradictory'] as const;
export type TransactionMilestoneVerificationState = (typeof TRANSACTION_MILESTONE_VERIFICATION_STATES)[number];

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
  readonly timezone: string;
  readonly responsibleMembershipId: string;
  readonly source: 'manual' | 'transaction-expected-close';
  readonly sourceType: TransactionMilestoneSourceType;
  readonly sourceReference: string;
  readonly sourceDate: string;
  readonly verificationState: TransactionMilestoneVerificationState;
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
  readonly timezone: string;
  readonly responsibleMembershipId: string;
  readonly sourceType: TransactionMilestoneSourceType;
  readonly sourceReference: string;
  readonly sourceDate: string;
  readonly verificationState: Exclude<TransactionMilestoneVerificationState, 'contradictory'>;
  readonly idempotencyKey: string;
}

export interface UpdateTransactionMilestoneInput {
  readonly milestoneId: string;
  readonly expectedVersion: number;
  readonly kind: TransactionMilestoneKind;
  readonly label: string;
  readonly dueAt: string;
  readonly timezone: string;
  readonly responsibleMembershipId: string;
  readonly sourceType: TransactionMilestoneSourceType;
  readonly sourceReference: string;
  readonly sourceDate: string;
  readonly verificationState: TransactionMilestoneVerificationState;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface TransitionTransactionMilestoneInput {
  readonly milestoneId: string;
  readonly expectedVersion: number;
  readonly nextState: Exclude<TransactionMilestoneState, 'open'>;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

function instant(value: string, label: string): string {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed.toISOString();
}

function calendarDate(value: string, label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} must be a valid date.`);
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) throw new Error(`${label} must be a valid date.`);
  return value;
}

function printable(value: string, label: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximum || CONTROL.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function timezone(value: string): string {
  const normalized = printable(value, 'Deadline timezone', 80);
  try { new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date()); } catch { throw new Error('Deadline timezone is invalid.'); }
  return normalized;
}

export function zonedLocalDateTimeToUtc(value: string, timeZone: string): string {
  const zone = timezone(timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Deadline local date and time is invalid.');
  const expected = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const wallClockAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const partsFor = (instantValue: number) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantValue)).map((part) => [part.type, part.value]));
  const first = partsFor(wallClockAsUtc);
  const representedAsUtc = Date.UTC(Number(first.year), Number(first.month) - 1, Number(first.day), Number(first.hour), Number(first.minute));
  const candidate = wallClockAsUtc - (representedAsUtc - wallClockAsUtc);
  const actual = partsFor(candidate);
  if (`${actual.year}-${actual.month}-${actual.day}T${actual.hour}:${actual.minute}` !== expected) {
    throw new Error('Deadline local time does not exist in the selected timezone because of daylight saving time.');
  }
  return new Date(candidate).toISOString();
}

function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Deadline version is invalid.');
  return value;
}

function reasonCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!normalized) throw new Error('Deadline change reason is required.');
  return normalized;
}

function idempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(normalized)) throw new Error('Deadline idempotency key is invalid.');
  return normalized;
}

export function validateTransactionMilestoneInput(input: CreateTransactionMilestoneInput): CreateTransactionMilestoneInput {
  if (!UUID.test(input.transactionId)) throw new Error('Choose a valid transaction.');
  if (!TRANSACTION_MILESTONE_KINDS.includes(input.kind)) throw new Error('Choose a valid deadline type.');
  const label = input.label.trim().replace(/\s+/g, ' ');
  if (!label || label.length > 120 || CONTROL.test(label)) throw new Error('Deadline name is invalid.');
  if (!UUID.test(input.responsibleMembershipId)) throw new Error('Choose a valid responsible person.');
  if (!TRANSACTION_MILESTONE_SOURCE_TYPES.includes(input.sourceType)) throw new Error('Choose a valid deadline source.');
  if (!['unverified', 'verified'].includes(input.verificationState)) throw new Error('Choose a valid verification state.');
  if (!UUID.test(input.idempotencyKey)) throw new Error('This deadline form expired. Refresh and try again.');
  return Object.freeze({
    ...input, label, dueAt: instant(input.dueAt, 'Deadline'), timezone: timezone(input.timezone),
    sourceReference: printable(input.sourceReference, 'Source reference', 240),
    sourceDate: calendarDate(input.sourceDate, 'Source date'),
  });
}

export function validateTransactionMilestoneUpdate(input: UpdateTransactionMilestoneInput): UpdateTransactionMilestoneInput {
  if (!UUID.test(input.milestoneId)) throw new Error('Choose a valid deadline.');
  if (!UUID.test(input.responsibleMembershipId)) throw new Error('Choose a valid responsible person.');
  if (!TRANSACTION_MILESTONE_KINDS.includes(input.kind)) throw new Error('Choose a valid deadline type.');
  if (!TRANSACTION_MILESTONE_SOURCE_TYPES.includes(input.sourceType)) throw new Error('Choose a valid deadline source.');
  if (!TRANSACTION_MILESTONE_VERIFICATION_STATES.includes(input.verificationState)) throw new Error('Choose a valid verification state.');
  return Object.freeze({
    ...input,
    expectedVersion: version(input.expectedVersion),
    label: printable(input.label, 'Deadline name', 120),
    dueAt: instant(input.dueAt, 'Deadline'),
    timezone: timezone(input.timezone),
    sourceReference: printable(input.sourceReference, 'Source reference', 240),
    sourceDate: calendarDate(input.sourceDate, 'Source date'),
    reasonCode: reasonCode(input.reasonCode),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  });
}

export function validateTransactionMilestoneTransition(input: TransitionTransactionMilestoneInput): TransitionTransactionMilestoneInput {
  if (!UUID.test(input.milestoneId)) throw new Error('Choose a valid deadline.');
  if (!TRANSACTION_MILESTONE_STATES.includes(input.nextState)) throw new Error('Choose a valid deadline outcome.');
  return Object.freeze({
    ...input,
    expectedVersion: version(input.expectedVersion),
    reasonCode: reasonCode(input.reasonCode),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  });
}

export function milestoneDaysOverdue(milestone: TransactionMilestone, now: Date): number {
  if (milestone.state !== 'open') return 0;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(milestone.dueAt)) / 86_400_000));
}

export function compareOperationalDeadline(left: TransactionMilestone, right: TransactionMilestone): number {
  return left.dueAt.localeCompare(right.dueAt) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
