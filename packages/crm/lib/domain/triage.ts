/**
 * Triage — the home screen's brain.
 *
 * Traces directly to the client's #1 grievance about her old CRM:
 *   "I wanted them organized by HOT to Nurture because that would tell me who
 *    needs my immediate attention and it didn't do that."
 *
 * So this is not a sorted contact list. It is a set of prioritised buckets
 * (the "Smart List" pattern) answering one question: who do I call today?
 *
 * Bucket order encodes Speed to Lead — the industry finding that the odds of
 * reaching a new lead collapse within minutes of them raising their hand. An
 * uncontacted new lead therefore outranks every overdue follow-up, no matter how
 * overdue, because a stale lead is a lost lead and an overdue past client is not.
 */

import { type Contact, type LeadType } from './contact.ts';
import { LEAD_WEIGHT, isDormant } from './cadence.ts';
import { daysBetween, daysUntilAnniversary, parseDateOnly, toDateOnly } from './dates.ts';

export type BucketId =
  | 'needs-first-contact'
  | 'overdue'
  | 'due-today'
  | 'celebrations'
  | 'coming-up';

export type BucketTone = 'hot' | 'warm' | 'nurture' | 'accent' | 'neutral';

export interface TriageEntry {
  contact: Contact;
  score: number;
  /** Why this person is in front of her right now. Shown in the UI. */
  reason: string;
  daysOverdue: number;
}

export interface TriageBucket {
  id: BucketId;
  title: string;
  /** One line explaining what the bucket is for. */
  blurb: string;
  /** Shown when the bucket is clear. Encouraging, never a blank panel. */
  emptyMessage: string;
  tone: BucketTone;
  entries: TriageEntry[];
}

export interface TriageOptions {
  /** Contacts created by a historical import are not treated as fresh inbound leads. */
  readonly historicalImportContactIds?: ReadonlySet<string>;
}

function needsImmediateFirstContact(contact: Contact, options: TriageOptions): boolean {
  return !contact.lastContactedAt && !options.historicalImportContactIds?.has(contact.id);
}

/** Birthdays are worth a week's notice; a card needs posting. */
export const BIRTHDAY_WINDOW_DAYS = 7;
/** Homeaversaries get a month — these are planned gestures, not last-minute texts. */
export const HOMEAVERSARY_WINDOW_DAYS = 30;
/** How far ahead "coming up" looks. */
export const UPCOMING_WINDOW_DAYS = 7;

/** Days past due. 0 when due today, negative when still in the future. */
export function daysOverdue(contact: Contact, now: Date): number {
  if (!contact.nextTouchAt) return 0;
  return daysBetween(parseDateOnly(contact.nextTouchAt), now);
}

/**
 * Priority within a bucket. Higher is more urgent.
 *
 * Overdueness dominates; lead weight breaks ties. That ordering matters given
 * Hot and Warm share a 7-day interval — without the weight they would be
 * indistinguishable, and she explicitly wants Hot surfaced first.
 */
export function priorityScore(contact: Contact, now: Date, options: TriageOptions = {}): number {
  const weight = LEAD_WEIGHT[contact.leadType];

  if (needsImmediateFirstContact(contact, options)) {
    // Speed to Lead: never contacted. Sits above everything, oldest first.
    const waiting = daysBetween(parseDateOnly(contact.createdAt), now);
    return 10_000 + weight * 100 + waiting;
  }

  return Math.max(0, daysOverdue(contact, now)) * 10 + weight;
}

function overdueReason(contact: Contact, overdue: number): string {
  if (overdue === 1) return '1 day overdue';
  if (overdue > 1) return `${overdue} days overdue`;
  return 'Due today';
}

function neverContactedReason(contact: Contact, now: Date): string {
  const waiting = daysBetween(parseDateOnly(contact.createdAt), now);
  const via = contact.source === 'other' ? 'added' : contact.source.replace('-', ' ');
  if (waiting === 0) return `New today · ${via}`;
  if (waiting === 1) return `Waiting 1 day · ${via}`;
  return `Waiting ${waiting} days · ${via}`;
}

function byScore(a: TriageEntry, b: TriageEntry): number {
  return b.score - a.score;
}

/**
 * Build the triage view.
 *
 * A contact appears in at most one follow-up bucket. Celebrations are a separate
 * axis, so someone can legitimately show up both as overdue and as having a
 * birthday this week — that's useful, not a duplicate.
 */
export function buildTriage(
  contacts: Contact[],
  now: Date = new Date(),
  options: TriageOptions = {},
): TriageBucket[] {
  const today = toDateOnly(now);
  const active = contacts.filter((c) => !isDormant(c));

  const needsFirstContact: TriageEntry[] = [];
  const overdue: TriageEntry[] = [];
  const dueToday: TriageEntry[] = [];
  const comingUp: TriageEntry[] = [];
  const celebrations: TriageEntry[] = [];

  for (const contact of active) {
    const score = priorityScore(contact, today, options);
    const overdueDays = daysOverdue(contact, today);

    if (needsImmediateFirstContact(contact, options)) {
      needsFirstContact.push({
        contact,
        score,
        reason: neverContactedReason(contact, today),
        daysOverdue: overdueDays,
      });
    } else if (overdueDays > 0) {
      overdue.push({ contact, score, reason: overdueReason(contact, overdueDays), daysOverdue: overdueDays });
    } else if (overdueDays === 0 && contact.nextTouchAt) {
      dueToday.push({ contact, score, reason: 'Due today', daysOverdue: 0 });
    } else if (contact.nextTouchAt && -overdueDays <= UPCOMING_WINDOW_DAYS) {
      const inDays = -overdueDays;
      comingUp.push({
        contact,
        score: UPCOMING_WINDOW_DAYS - inDays,
        reason: inDays === 1 ? 'Tomorrow' : `In ${inDays} days`,
        daysOverdue: overdueDays,
      });
    }

    // Celebrations — independent of follow-up state.
    if (contact.birthdate) {
      const until = daysUntilAnniversary(contact.birthdate, today);
      if (until <= BIRTHDAY_WINDOW_DAYS) {
        celebrations.push({
          contact,
          score: 1_000 - until,
          reason: until === 0 ? '🎂 Birthday today' : `🎂 Birthday in ${until} day${until === 1 ? '' : 's'}`,
          daysOverdue: 0,
        });
      }
    }
    if (contact.homePurchaseDate) {
      const until = daysUntilAnniversary(contact.homePurchaseDate, today);
      if (until <= HOMEAVERSARY_WINDOW_DAYS) {
        celebrations.push({
          contact,
          score: 500 - until,
          reason: until === 0 ? '🏡 Homeaversary today' : `🏡 Homeaversary in ${until} day${until === 1 ? '' : 's'}`,
          daysOverdue: 0,
        });
      }
    }
  }

  return [
    {
      id: 'needs-first-contact',
      title: 'Needs first contact',
      blurb: 'Never been reached. These go cold fastest — call before anything else.',
      emptyMessage: 'Everyone new has been reached. That is the hard part done.',
      tone: 'hot',
      entries: needsFirstContact.sort(byScore),
    },
    {
      id: 'overdue',
      title: 'Overdue',
      blurb: 'Past their follow-up date, most overdue first.',
      emptyMessage: 'Nothing overdue. You are genuinely on top of it.',
      tone: 'warm',
      entries: overdue.sort(byScore),
    },
    {
      id: 'due-today',
      title: 'Due today',
      blurb: "Today's follow-ups, Hot first.",
      emptyMessage: 'Nothing due today.',
      tone: 'accent',
      entries: dueToday.sort(byScore),
    },
    {
      id: 'celebrations',
      title: 'Birthdays & homeaversaries',
      blurb: 'The easiest calls you will make all week — and the ones that generate referrals.',
      emptyMessage: 'No birthdays or homeaversaries coming up.',
      tone: 'nurture',
      entries: celebrations.sort(byScore),
    },
    {
      id: 'coming-up',
      title: 'Coming up',
      blurb: `The next ${UPCOMING_WINDOW_DAYS} days, so nothing surprises you.`,
      emptyMessage: 'Clear for the week ahead.',
      tone: 'neutral',
      entries: comingUp.sort(byScore),
    },
  ];
}

export interface TriageSummary {
  needsAttentionNow: number;
  overdueCount: number;
  dueTodayCount: number;
  celebrationCount: number;
  byLeadType: Record<LeadType, number>;
}

/** Headline counts for the top of the page. */
export function summarise(buckets: TriageBucket[]): TriageSummary {
  const find = (id: BucketId) => buckets.find((b) => b.id === id)?.entries ?? [];

  const first = find('needs-first-contact');
  const late = find('overdue');
  const today = find('due-today');

  const byLeadType: Record<LeadType, number> = { hot: 0, warm: 0, nurture: 0 };
  for (const entry of [...first, ...late, ...today]) {
    byLeadType[entry.contact.leadType] += 1;
  }

  return {
    needsAttentionNow: first.length + late.length + today.length,
    overdueCount: late.length,
    dueTodayCount: today.length,
    celebrationCount: find('celebrations').length,
    byLeadType,
  };
}
