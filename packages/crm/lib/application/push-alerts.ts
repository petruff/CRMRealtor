import type { TransactionMilestone } from '../domain/operational-signal.ts';

/**
 * Real-time and daily alerts beyond the morning brief. Every alert respects
 * the device's own choices (which kinds, quiet hours) and hides names from the
 * lock screen unless the member opted in.
 */

export interface AlertPreferences {
  readonly alertNewLeads: boolean;
  readonly alertDeadlines: boolean;
  readonly quietStartHour: number;
  readonly quietEndHour: number;
  readonly showNames: boolean;
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  alertNewLeads: true, alertDeadlines: true, quietStartHour: 21, quietEndHour: 7, showNames: false,
};

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag?: string;
}

function localHour(now: Date, timeZone: string): number {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour === 24 ? 0 : hour;
}

/** Quiet hours wrap midnight (e.g. 21 → 7). Equal start and end means never quiet. */
export function inQuietHours(now: Date, timeZone: string, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  const hour = localHour(now, timeZone);
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

const SOURCE_LABEL: Record<string, string> = {
  website: 'your website', zillow: 'Zillow', 'realtor-com': 'Realtor.com', 'social-media': 'social media', facebook: 'Facebook',
  instagram: 'Instagram', 'open-house': 'an open house', referral: 'a referral', 'cold-call': 'a cold call', other: 'a new source',
};

export function newLeadAlert(lead: { readonly contactId: string; readonly firstName?: string; readonly lastName?: string; readonly source?: string }, showNames: boolean): PushPayload {
  const from = SOURCE_LABEL[lead.source ?? ''] ?? 'a new source';
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  return {
    title: showNames && name ? `New lead: ${name}` : 'New lead waiting',
    body: `From ${from}. The first agent to call usually wins — tap to open and call.`,
    url: `/contacts/${encodeURIComponent(lead.contactId)}`,
    tag: `omnix-new-lead-${lead.contactId}`,
  };
}

export function newLeadsAlert(leads: readonly { readonly contactId: string; readonly firstName?: string; readonly lastName?: string; readonly source?: string }[], showNames: boolean): PushPayload | undefined {
  const [first] = leads;
  if (!first) return undefined;
  if (leads.length === 1) return newLeadAlert(first, showNames);
  return {
    title: `${leads.length} new leads waiting`,
    body: 'The first agent to call usually wins — tap to see them.',
    url: '/contacts?scope=leads',
    tag: 'omnix-new-leads',
  };
}

export interface UrgentDeadline {
  readonly label: string;
  readonly propertyAddress: string;
  readonly when: 'overdue' | 'today' | 'tomorrow';
}

function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Open deal dates that are overdue, due today or tomorrow (local), soonest first. */
export function urgentDeadlines(milestones: readonly TransactionMilestone[], now: Date, timeZone: string): UrgentDeadline[] {
  const today = calendarDay(now, timeZone);
  const tomorrow = calendarDay(new Date(now.getTime() + 86_400_000), timeZone);
  return milestones
    .filter((milestone) => milestone.state === 'open')
    .map((milestone) => {
      const day = calendarDay(new Date(milestone.dueAt), milestone.timezone || timeZone);
      const when = Date.parse(milestone.dueAt) < now.getTime() && day < today ? 'overdue' : day === today ? 'today' : day === tomorrow ? 'tomorrow' : undefined;
      return when ? { label: milestone.label, propertyAddress: milestone.propertyAddress, when, dueAt: milestone.dueAt } : undefined;
    })
    .filter((item): item is UrgentDeadline & { dueAt: string } => Boolean(item))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
    .map(({ label, propertyAddress, when }) => ({ label, propertyAddress, when }));
}

const WHEN_LABEL: Record<UrgentDeadline['when'], string> = { overdue: 'overdue', today: 'due today', tomorrow: 'due tomorrow' };

/** One calm line for the morning brief, e.g. "Inspection period ends — due tomorrow (1408 Bayshore Dr)". */
export function deadlineLine(deadlines: readonly UrgentDeadline[], showNames: boolean): string | undefined {
  const [first] = deadlines;
  if (!first) return undefined;
  const more = deadlines.length > 1 ? ` + ${deadlines.length - 1} more` : '';
  return showNames
    ? `${first.label} — ${WHEN_LABEL[first.when]} (${first.propertyAddress})${more}.`
    : `${deadlines.length} deal ${deadlines.length === 1 ? 'date' : 'dates'} ${first.when === 'overdue' ? `${deadlines.length === 1 ? 'needs' : 'need'} attention now` : 'in the next 48 hours'}.`;
}
