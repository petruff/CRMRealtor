import { describe, expect, it } from 'vitest';
import { parsePowerHourSession, powerHourHref } from './power-hour-session';

describe('power hour session', () => {
  it('round-trips progress through the URL', () => {
    const session = parsePowerHourSession({ done: '3', skip: 'c-1,c-2' });
    expect(session).toEqual({ done: 3, skip: ['c-1', 'c-2'] });
    expect(powerHourHref(session)).toBe('/power-hour?done=3&skip=c-1%2Cc-2');
    expect(powerHourHref({ done: 0, skip: [] })).toBe('/power-hour');
  });

  it('rejects hostile or malformed input', () => {
    expect(parsePowerHourSession({ done: '-1', skip: '../x,<script>,ok_id,ok_id' })).toEqual({ done: 0, skip: ['ok_id'] });
    expect(parsePowerHourSession({ done: '1e9' }).done).toBe(0);
    expect(parsePowerHourSession({ skip: Array.from({ length: 300 }, (_, index) => `id${index}`).join(',') }).skip).toHaveLength(200);
  });
});
