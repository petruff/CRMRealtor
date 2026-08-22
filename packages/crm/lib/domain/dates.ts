/**
 * Date-only arithmetic in UTC.
 *
 * Follow-up dates, birthdays and anniversaries are calendar facts, not instants.
 * Doing this maths in local time causes touches to drift a day across DST
 * boundaries and makes "due today" wrong for anyone travelling — which an agent
 * does constantly. Everything here floors to a UTC midnight and stays there.
 */

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` (or the date half of an ISO timestamp) to a UTC midnight. */
export function parseDateOnly(iso: string): Date {
  const parts = iso.slice(0, 10).split('-');
  const year = Number(parts[0] ?? '1970');
  const month = Number(parts[1] ?? '1');
  const day = Number(parts[2] ?? '1');
  return new Date(Date.UTC(year, month - 1, day));
}

/** Floor any instant to its UTC date. */
export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / MS_PER_DAY);
}

/**
 * Days until the next occurrence of a date's month/day.
 * Returns 0 when it falls today. Birth years are frequently wrong or unknown,
 * so the year is deliberately ignored.
 */
export function daysUntilAnniversary(iso: string, from: Date): number {
  const source = parseDateOnly(iso);
  const today = toDateOnly(from);
  const month = source.getUTCMonth();
  const day = source.getUTCDate();

  let next = new Date(Date.UTC(today.getUTCFullYear(), month, day));

  // Feb 29 in a non-leap year rolls to Mar 1; acknowledge it rather than skipping.
  if (next.getUTCMonth() !== month) {
    next = new Date(Date.UTC(today.getUTCFullYear(), month + 1, 1));
  }
  if (next.getTime() < today.getTime()) {
    next = new Date(Date.UTC(today.getUTCFullYear() + 1, month, day));
    if (next.getUTCMonth() !== month) {
      next = new Date(Date.UTC(today.getUTCFullYear() + 1, month + 1, 1));
    }
  }
  return daysBetween(today, next);
}

/** Which anniversary this will be — 3 means "3 years in their home". */
export function anniversaryOrdinal(iso: string, from: Date): number {
  const source = parseDateOnly(iso);
  const today = toDateOnly(from);
  let years = today.getUTCFullYear() - source.getUTCFullYear();
  const passedThisYear =
    today.getUTCMonth() > source.getUTCMonth() ||
    (today.getUTCMonth() === source.getUTCMonth() && today.getUTCDate() >= source.getUTCDate());
  if (!passedThisYear) years -= 1;
  return years + 1;
}

/** "in 3 days", "today", "5 days ago" — plain language beats a date string. */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export function formatHuman(iso: string): string {
  return parseDateOnly(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMonthDay(iso: string): string {
  return parseDateOnly(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
