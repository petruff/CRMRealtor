import { daysBetween, parseDateOnly } from '../domain/dates.ts';

/**
 * US, realtor-facing date language. Calendar facts (follow-up dates,
 * birthdays, closing dates) are date-only and compared in UTC; instants
 * (a reply received, an edit) are rendered in the realtor's time zone.
 */

const WEEKDAY_MONTH_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Today", "Tomorrow", "Yesterday", "Thu, Sep 24", or "Sep 24, 2027" outside the current year. */
export function formatCalendarDay(isoDate: string, now: Date): string {
  const target = parseDateOnly(isoDate);
  const offset = daysBetween(now, target);
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  if (target.getUTCFullYear() !== now.getUTCFullYear()) return MONTH_DAY_YEAR.format(target);
  return WEEKDAY_MONTH_DAY.format(target);
}

/** Follow-up language: "3 days overdue", "Due today", "Due tomorrow", "Due Thu, Sep 24". */
export function formatDueLabel(isoDate: string, now: Date): string {
  const offset = daysBetween(now, parseDateOnly(isoDate));
  if (offset < 0) return `${-offset} ${offset === -1 ? 'day' : 'days'} overdue`;
  if (offset === 0) return 'Due today';
  if (offset === 1) return 'Due tomorrow';
  return `Due ${formatCalendarDay(isoDate, now)}`;
}

/** "9:30 AM" in the given IANA zone. */
export function formatClockTime(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(instant));
}

/** "Just now", "12 min ago", "3 hr ago", "Yesterday", then a calendar day. */
export function formatSince(instant: string | Date, now: Date, timeZone: string): string {
  const then = new Date(instant);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 12) return `${hours} hr ago`;
  const localDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(then);
  const localToday = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(now);
  if (localDate === localToday) return `Today, ${formatClockTime(then, timeZone)}`;
  return formatCalendarDay(localDate, new Date(`${localToday}T00:00:00.000Z`));
}
