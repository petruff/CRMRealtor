import { describe, expect, it } from 'vitest';
import { daysBetween, parseDateOnly, relativeDays } from './dates';

describe('relative date language', () => {
  const today = parseDateOnly('2026-08-10');

  it('describes future dates without reversing the sign', () => {
    const future = parseDateOnly('2026-08-25');
    expect(relativeDays(daysBetween(today, future))).toBe('in 15 days');
  });

  it('describes past dates with a negative distance', () => {
    const past = parseDateOnly('2026-08-05');
    expect(relativeDays(-daysBetween(past, today))).toBe('5 days ago');
  });

  it('uses plain language for adjacent dates', () => {
    expect(relativeDays(1)).toBe('tomorrow');
    expect(relativeDays(-1)).toBe('yesterday');
  });

  it('labels the current date as today', () => {
    expect(relativeDays(0)).toBe('today');
  });
});
