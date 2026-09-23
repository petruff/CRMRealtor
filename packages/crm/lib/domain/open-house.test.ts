import { describe, expect, it } from 'vitest';
import {
  OPEN_HOUSE_CONSENT_VERSION, OPEN_HOUSE_SMS_CONSENT_TEXT, OpenHouseError, openHouseLeadType, openHouseNote,
  openHouseTag, parseOpenHouseSignIn, validateOpenHouseProperty,
} from './open-house.ts';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function errorsOf(run: () => unknown): Record<string, string> {
  try { run(); } catch (error) { if (error instanceof OpenHouseError) return { ...error.fieldErrors }; throw error; }
  throw new Error('expected OpenHouseError');
}

describe('parseOpenHouseSignIn', () => {
  it('normalizes a complete sign-in and strips the US country code', () => {
    const signIn = parseOpenHouseSignIn(form({
      firstName: '  Maria ', lastName: 'Lopez', phone: '+1 (813) 555-0142', email: 'Maria@Example.COM',
      intent: 'seller', timeframe: '3-months', hasAgent: 'no', smsConsent: 'on', comments: 'Loved   the lanai',
    }));
    expect(signIn).toMatchObject({
      firstName: 'Maria', lastName: 'Lopez', phoneDigits: '8135550142', email: 'maria@example.com',
      intent: 'seller', timeframe: '3-months', hasAgent: false, smsConsent: true, emailConsent: false, comments: 'Loved the lanai',
    });
  });

  it('requires names and at least one way to follow up', () => {
    expect(errorsOf(() => parseOpenHouseSignIn(form({})))).toEqual({
      firstName: expect.any(String), lastName: expect.any(String), phone: expect.stringContaining('phone number or an email'),
    });
  });

  it('rejects consent to a channel the visitor did not provide', () => {
    const errors = errorsOf(() => parseOpenHouseSignIn(form({ firstName: 'A', lastName: 'B', email: 'a@b.co', smsConsent: 'on' })));
    expect(errors).toEqual({ smsConsent: 'Add a phone number to receive texts.' });
    expect(errorsOf(() => parseOpenHouseSignIn(form({ firstName: 'A', lastName: 'B', phone: '8135550142', emailConsent: 'on' }))))
      .toEqual({ emailConsent: 'Add an email to receive updates.' });
  });

  it('flags malformed phone, email, overlong and control-character input', () => {
    const errors = errorsOf(() => parseOpenHouseSignIn(form({
      firstName: 'x'.repeat(81), lastName: 'B\u0007', phone: '555-01', email: 'nope',
    })));
    expect(Object.keys(errors).sort()).toEqual(['email', 'firstName', 'lastName', 'phone']);
  });

  it('defaults consent to off and unknown values to safe choices', () => {
    const signIn = parseOpenHouseSignIn(form({ firstName: 'A', lastName: 'B', email: 'a@b.co', intent: 'hacker', timeframe: 'yesterday' }));
    expect(signIn).toMatchObject({ intent: 'unknown', timeframe: 'just-looking', smsConsent: false, emailConsent: false, hasAgent: false });
  });
});

describe('open house helpers', () => {
  it('validates the property address', () => {
    expect(validateOpenHouseProperty('  1408  Bayshore Dr ')).toBe('1408 Bayshore Dr');
    expect(() => validateOpenHouseProperty('x')).toThrow(OpenHouseError);
    expect(() => validateOpenHouseProperty(undefined)).toThrow(OpenHouseError);
  });

  it('derives temperature only from stated timeframe and agent status', () => {
    expect(openHouseLeadType({ hasAgent: false, timeframe: 'now' })).toBe('hot');
    expect(openHouseLeadType({ hasAgent: false, timeframe: '3-months' })).toBe('hot');
    expect(openHouseLeadType({ hasAgent: false, timeframe: '6-months' })).toBe('warm');
    expect(openHouseLeadType({ hasAgent: false, timeframe: 'just-looking' })).toBe('nurture');
    expect(openHouseLeadType({ hasAgent: true, timeframe: 'now' })).toBe('nurture');
  });

  it('builds a stable per-day tag', () => {
    expect(openHouseTag('1408 Bayshore Dr, Tampa, FL', '2026-09-27')).toBe('open-house:2026-09-27:1408-bayshore-dr-tampa-fl');
  });

  it('records consent wording, version and the Article 16 warning in the note', () => {
    const note = openHouseNote(parseOpenHouseSignIn(form({
      firstName: 'A', lastName: 'B', phone: '8135550142', smsConsent: 'on', hasAgent: 'yes', timeframe: 'now',
    })), '1408 Bayshore Dr', '2026-09-27T15:00:00.000Z');
    expect(note).toContain('1408 Bayshore Dr');
    expect(note).toContain('Article 16');
    expect(note).toContain(OPEN_HOUSE_CONSENT_VERSION);
    expect(note).toContain(OPEN_HOUSE_SMS_CONSENT_TEXT);
  });
});
