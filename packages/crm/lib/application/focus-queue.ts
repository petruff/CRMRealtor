import {
  INTENT_LABEL, PIPELINE_LABEL, SOURCE_LABEL, displayName, initials,
  type Contact, type LeadType, type Relationship,
} from '../domain/contact.ts';
import { anniversaryOrdinal, daysBetween, daysUntilAnniversary, parseDateOnly } from '../domain/dates.ts';
import type { TriageBucket } from '../domain/triage.ts';
import { formatCalendarDay } from '../presentation/us-dates.ts';

/**
 * Today's single ordered work list.
 *
 * Built from the triage buckets (Speed-to-Lead first, then most overdue, then
 * due today) and rewritten in the realtor's own language: who, why now, and
 * enough context to open the conversation without clicking through.
 */

export type FocusKind = 'first-contact' | 'overdue' | 'due-today';

export interface FocusItem {
  readonly contactId: string;
  readonly name: string;
  readonly initials: string;
  readonly leadType: LeadType;
  readonly relationship: Relationship;
  readonly kind: FocusKind;
  /** Why this person, right now — one short sentence. */
  readonly why: string;
  /** What she needs to remember before dialing. */
  readonly context: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface FocusMoment {
  readonly contactId: string;
  readonly name: string;
  readonly initials: string;
  readonly leadType: LeadType;
  readonly relationship: Relationship;
  readonly kind: 'birthday' | 'homeaversary';
  readonly label: string;
  readonly inDays: number;
}

const KIND_BY_BUCKET: Partial<Record<TriageBucket['id'], FocusKind>> = {
  'needs-first-contact': 'first-contact',
  overdue: 'overdue',
  'due-today': 'due-today',
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function why(contact: Contact, kind: FocusKind, now: Date): string {
  if (kind === 'first-contact') {
    const waiting = Math.max(0, daysBetween(parseDateOnly(contact.createdAt), now));
    const source = contact.source === 'other' ? 'New lead' : `New ${SOURCE_LABEL[contact.source].toLowerCase()} lead`;
    return waiting === 0 ? `${source} — reach out today` : `${source}, waiting ${plural(waiting, 'day')} for a first call`;
  }
  const spoke = contact.lastContactedAt ? formatCalendarDay(contact.lastContactedAt, now) : undefined;
  const last = !spoke ? 'no conversation logged yet'
    : /^(Today|Yesterday|Tomorrow)$/u.test(spoke) ? `last spoke ${spoke.toLowerCase()}` : `last spoke ${spoke}`;
  if (kind === 'overdue' && contact.nextTouchAt) {
    const overdue = daysBetween(parseDateOnly(contact.nextTouchAt), now);
    return `Follow-up ${plural(overdue, 'day')} overdue · ${last}`;
  }
  return `Follow-up due today · ${last}`;
}

function context(contact: Contact): string {
  return [
    contact.intent !== 'unknown' ? INTENT_LABEL[contact.intent] : undefined,
    contact.pipelineStage !== 'new' ? PIPELINE_LABEL[contact.pipelineStage] : undefined,
    contact.buyer?.priceMax ? `up to $${Math.round(contact.buyer.priceMax / 1000)}k` : undefined,
    contact.city,
  ].filter(Boolean).join(' · ');
}

export function buildFocusQueue(buckets: readonly TriageBucket[], now: Date): FocusItem[] {
  const seen = new Set<string>();
  const items: FocusItem[] = [];
  for (const bucket of buckets) {
    const kind = KIND_BY_BUCKET[bucket.id];
    if (!kind) continue;
    for (const { contact } of bucket.entries) {
      if (seen.has(contact.id)) continue;
      seen.add(contact.id);
      items.push({
        contactId: contact.id,
        name: displayName(contact),
        initials: initials(contact),
        leadType: contact.leadType,
        relationship: contact.relationship,
        kind,
        why: why(contact, kind, now),
        context: context(contact),
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(contact.email ? { email: contact.email } : {}),
      });
    }
  }
  return items;
}

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}

function inPhrase(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Birthdays and homeaversaries worth a personal note, soonest first. */
export function buildFocusMoments(buckets: readonly TriageBucket[], now: Date, limit = 4): FocusMoment[] {
  const moments: FocusMoment[] = [];
  for (const { contact } of buckets.find((bucket) => bucket.id === 'celebrations')?.entries ?? []) {
    const base = {
      contactId: contact.id, name: displayName(contact), initials: initials(contact),
      leadType: contact.leadType, relationship: contact.relationship,
    };
    if (contact.birthdate) {
      const inDays = daysUntilAnniversary(contact.birthdate, now);
      if (inDays <= 14) moments.push({ ...base, kind: 'birthday', inDays, label: `Birthday ${inPhrase(inDays)}` });
    }
    if (contact.homePurchaseDate) {
      const inDays = daysUntilAnniversary(contact.homePurchaseDate, now);
      if (inDays <= 30) {
        moments.push({ ...base, kind: 'homeaversary', inDays, label: `${ordinal(anniversaryOrdinal(contact.homePurchaseDate, now))} home anniversary ${inPhrase(inDays)}` });
      }
    }
  }
  const unique = new Map(moments.map((moment) => [`${moment.contactId}:${moment.kind}`, moment]));
  return [...unique.values()].sort((left, right) => left.inDays - right.inDays).slice(0, limit);
}
