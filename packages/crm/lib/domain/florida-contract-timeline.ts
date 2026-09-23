import type { TransactionMilestoneKind } from './operational-signal.ts';

/**
 * Proposed deadlines for a Florida Realtors/Florida Bar "AS IS" residential
 * contract, counted from the Effective Date (day 0) in calendar days. A period
 * that ends on a Saturday, Sunday or national legal holiday rolls to the next
 * business day. These are the form's defaults when a blank is left empty; the
 * realtor confirms every period against the signed contract before anything is
 * saved, and Omnix never presents them as legal advice.
 */

export type Financing = 'financed' | 'cash';

export interface TimelineInput {
  readonly effectiveDate: string;
  readonly closingDate: string;
  readonly financing: Financing;
  readonly depositDays: number;
  readonly inspectionDays: number;
  readonly loanApplicationDays: number;
  readonly loanApprovalDays: number;
  readonly additionalDepositDays?: number;
}

export const TIMELINE_DEFAULTS = {
  depositDays: 3,
  inspectionDays: 15,
  loanApplicationDays: 5,
  loanApprovalDays: 30,
} as const;

export interface ProposedDeadline {
  readonly key: 'initial-deposit' | 'additional-deposit' | 'loan-application' | 'inspection' | 'loan-approval' | 'closing';
  readonly kind: TransactionMilestoneKind;
  readonly label: string;
  /** Local calendar date the period ends (after any weekend/holiday roll). */
  readonly date: string;
  readonly rolled: boolean;
}

export class TimelineError extends Error {
  readonly fieldErrors: Readonly<Record<string, string>>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'TimelineError';
    this.fieldErrors = fieldErrors;
  }
}

function utc(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return iso(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7, 12)));
}
function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0, 12));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return iso(new Date(Date.UTC(year, month + 1, -offset, 12)));
}

/** U.S. federal (national legal) holidays on their actual dates. */
export function nationalHolidays(year: number): ReadonlySet<string> {
  const fixed = (month: number, day: number) => iso(new Date(Date.UTC(year, month, day, 12)));
  return new Set([
    fixed(0, 1), nthWeekday(year, 0, 1, 3), nthWeekday(year, 1, 1, 3), lastWeekday(year, 4, 1), fixed(5, 19),
    fixed(6, 4), nthWeekday(year, 8, 1, 1), nthWeekday(year, 9, 1, 2), fixed(10, 11), nthWeekday(year, 10, 4, 4), fixed(11, 25),
  ]);
}

export function isBusinessDay(date: string): boolean {
  const day = utc(date).getUTCDay();
  return day !== 0 && day !== 6 && !nationalHolidays(Number(date.slice(0, 4))).has(date);
}

/** Effective Date is day 0; the result rolls past weekends and national legal holidays. */
export function periodEnd(effectiveDate: string, days: number): { date: string; rolled: boolean } {
  const base = utc(effectiveDate);
  let end = new Date(base.getTime() + days * 86_400_000);
  let rolled = false;
  while (!isBusinessDay(iso(end))) { end = new Date(end.getTime() + 86_400_000); rolled = true; }
  return { date: iso(end), rolled };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = utc(value);
  return !Number.isNaN(parsed.getTime()) && iso(parsed) === value;
}

function days(value: unknown, field: string, errors: Record<string, string>, min: number, max: number, optional = false): number | undefined {
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) { errors[field] = `Use a whole number from ${min} to ${max}.`; return undefined; }
  return parsed;
}

export function parseTimelineInput(form: FormData): TimelineInput {
  const errors: Record<string, string> = {};
  const effectiveDate = String(form.get('effectiveDate') ?? '');
  const closingDate = String(form.get('closingDate') ?? '');
  if (!validDate(effectiveDate)) errors.effectiveDate = 'Enter the Effective Date from the contract.';
  if (!validDate(closingDate)) errors.closingDate = 'Enter the closing date from the contract.';
  if (!errors.effectiveDate && !errors.closingDate && closingDate <= effectiveDate) errors.closingDate = 'Closing must be after the Effective Date.';
  const financing: Financing = form.get('financing') === 'cash' ? 'cash' : 'financed';
  const depositDays = days(form.get('depositDays'), 'depositDays', errors, 1, 30);
  const inspectionDays = days(form.get('inspectionDays'), 'inspectionDays', errors, 1, 60);
  const loanApplicationDays = financing === 'cash' ? TIMELINE_DEFAULTS.loanApplicationDays : days(form.get('loanApplicationDays'), 'loanApplicationDays', errors, 1, 30);
  const loanApprovalDays = financing === 'cash' ? TIMELINE_DEFAULTS.loanApprovalDays : days(form.get('loanApprovalDays'), 'loanApprovalDays', errors, 1, 90);
  const additionalDepositDays = days(form.get('additionalDepositDays'), 'additionalDepositDays', errors, 1, 90, true);
  if (Object.keys(errors).length) throw new TimelineError('Please check the highlighted fields.', errors);
  return {
    effectiveDate, closingDate, financing,
    depositDays: depositDays as number, inspectionDays: inspectionDays as number,
    loanApplicationDays: loanApplicationDays as number, loanApprovalDays: loanApprovalDays as number,
    ...(additionalDepositDays ? { additionalDepositDays } : {}),
  };
}

export function proposeTimeline(input: TimelineInput): ProposedDeadline[] {
  const entry = (key: ProposedDeadline['key'], kind: TransactionMilestoneKind, label: string, count: number): ProposedDeadline => ({ key, kind, label, ...periodEnd(input.effectiveDate, count) });
  const items: ProposedDeadline[] = [entry('initial-deposit', 'custom', 'Initial escrow deposit due', input.depositDays)];
  if (input.financing === 'financed') items.push(entry('loan-application', 'financing', 'Loan application due', input.loanApplicationDays));
  items.push(entry('inspection', 'inspection', 'Inspection period ends', input.inspectionDays));
  if (input.additionalDepositDays) items.push(entry('additional-deposit', 'custom', 'Additional deposit due', input.additionalDepositDays));
  if (input.financing === 'financed') items.push(entry('loan-approval', 'financing', 'Loan approval period ends', input.loanApprovalDays));
  items.push({ key: 'closing', kind: 'closing', label: 'Closing', date: input.closingDate, rolled: false });
  return items.sort((left, right) => left.date.localeCompare(right.date));
}
