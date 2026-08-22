/**
 * Follow-up cadence engine.
 *
 * Intervals are the client's own, confirmed 2026-08-10:
 *   Hot 7 days · Warm 7 days · Nurture 30 days
 *
 * Hot and Warm deliberately share an interval — she chose that. It means the
 * interval alone cannot separate them, so LEAD_WEIGHT does the separating in the
 * triage sort (see `triage.ts`). This matches what she actually asked for:
 * "organized by HOT to Nurture ... who needs my immediate attention".
 *
 * No accelerated onboarding program is inferred. Judith approved weekly Hot,
 * weekly Warm (manually adjustable to every two weeks), and monthly Nurture.
 */

import { DORMANT_STAGES, type Contact, type LeadType } from './contact.ts';
import { addDays, formatDateOnly, parseDateOnly, toDateOnly } from './dates.ts';

/** Days between touches, at steady state. */
export const CADENCE_DAYS: Record<LeadType, number> = {
  hot: 7,
  warm: 7,
  nurture: 30,
};

/**
 * Tie-break weight when two contacts are equally overdue.
 * Hot outranks Warm outranks Nurture.
 */
export const LEAD_WEIGHT: Record<LeadType, number> = {
  hot: 3,
  warm: 2,
  nurture: 1,
};

/** Closed and lost contacts have no cadence. */
export function isDormant(contact: Contact): boolean {
  return DORMANT_STAGES.includes(contact.pipelineStage);
}

/**
 * The client-approved interval currently in force for this contact.
 */
export function effectiveCadenceDays(contact: Contact, now: Date): number {
  void now;
  return CADENCE_DAYS[contact.leadType];
}

/**
 * The next touch date after a conversation happening on `from`.
 * Returns undefined for dormant contacts — nothing to schedule.
 */
export function computeNextTouch(contact: Contact, from: Date): string | undefined {
  if (isDormant(contact)) return undefined;
  return formatDateOnly(addDays(toDateOnly(from), effectiveCadenceDays(contact, from)));
}

/**
 * Apply a completed touch: stamp the conversation and schedule the next one.
 *
 * A manual override is respected only until it is spent — once she has had the
 * conversation, the engine resumes. Otherwise a single hand-set date would
 * silently freeze that contact's cadence forever.
 */
export function recordTouch(contact: Contact, at: Date): Contact {
  return {
    ...contact,
    lastContactedAt: at.toISOString(),
    nextTouchAt: computeNextTouch(contact, at),
    touchDateOverridden: false,
    pipelineStage: contact.pipelineStage === 'new' ? 'contacted' : contact.pipelineStage,
  };
}

/** Hand-set a touch date. Suppresses recalculation until the next conversation. */
export function overrideNextTouch(contact: Contact, date: string): Contact {
  return { ...contact, nextTouchAt: date, touchDateOverridden: true };
}

/**
 * Backfill a missing touch date, e.g. after an import.
 * Never overwrites an existing date or a manual override.
 */
export function ensureNextTouch(contact: Contact, now: Date): Contact {
  if (contact.nextTouchAt || contact.touchDateOverridden || isDormant(contact)) return contact;

  const anchor = contact.lastContactedAt
    ? parseDateOnly(contact.lastContactedAt)
    : parseDateOnly(contact.createdAt);

  const due = addDays(anchor, effectiveCadenceDays(contact, now));
  // Never schedule into the past — an imported contact is due now, not overdue by a year.
  const next = due.getTime() < toDateOnly(now).getTime() ? toDateOnly(now) : due;
  return { ...contact, nextTouchAt: formatDateOnly(next) };
}

/**
 * Place a historical import on the next stable slot in its approved cadence.
 * The contact ID chooses the slot, so a bulk migration does not turn one import
 * timestamp into an all-database emergency. Manual dates are handled by callers.
 */
export function historicalImportNextTouch(contact: Contact, now: Date): string | undefined {
  if (isDormant(contact)) return undefined;
  const interval = CADENCE_DAYS[contact.leadType];
  let hash = 2166136261;
  for (const character of contact.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const slot = (hash >>> 0) % interval;
  const today = toDateOnly(now);
  const dayNumber = Math.floor(today.getTime() / 86_400_000);
  const delta = (slot - (dayNumber % interval) + interval) % interval;
  return formatDateOnly(addDays(today, delta));
}
