import { describe, expect, it } from 'vitest';
import { formatCalendarDay, formatClockTime, formatDueLabel, formatSince } from './us-dates';

const NOW = new Date('2026-09-23T15:00:00.000Z');

describe('US realtor date language', () => {
  it('names nearby days and uses weekday + month elsewhere', () => {
    expect(formatCalendarDay('2026-09-23', NOW)).toBe('Today');
    expect(formatCalendarDay('2026-09-24', NOW)).toBe('Tomorrow');
    expect(formatCalendarDay('2026-09-22', NOW)).toBe('Yesterday');
    expect(formatCalendarDay('2026-09-29', NOW)).toBe('Tue, Sep 29');
    expect(formatCalendarDay('2027-01-04', NOW)).toBe('Jan 4, 2027');
  });

  it('never shows ISO dates for follow-ups', () => {
    expect(formatDueLabel('2026-09-03', NOW)).toBe('20 days overdue');
    expect(formatDueLabel('2026-09-22', NOW)).toBe('1 day overdue');
    expect(formatDueLabel('2026-09-23', NOW)).toBe('Due today');
    expect(formatDueLabel('2026-09-24', NOW)).toBe('Due tomorrow');
    expect(formatDueLabel('2026-09-29', NOW)).toBe('Due Tue, Sep 29');
    expect(formatDueLabel('2026-09-29T10:00:00Z', NOW)).not.toMatch(/\d{4}-\d{2}/);
  });

  it('renders instants in the realtor time zone', () => {
    expect(formatClockTime('2026-09-23T13:30:00.000Z', 'America/New_York')).toBe('9:30 AM');
    expect(formatSince('2026-09-23T14:50:00.000Z', NOW, 'America/New_York')).toBe('10 min ago');
    expect(formatSince('2026-09-23T12:00:00.000Z', NOW, 'America/New_York')).toBe('3 hr ago');
    expect(formatSince('2026-09-22T12:00:00.000Z', NOW, 'America/New_York')).toBe('Yesterday');
    expect(formatSince('2026-09-23T14:59:40.000Z', NOW, 'America/New_York')).toBe('Just now');
  });
});
