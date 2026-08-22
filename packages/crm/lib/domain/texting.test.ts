import { describe, expect, it } from 'vitest';
import {
  assertTextingDeliveryTransition,
  consentStatusForTwilioKeyword,
  evaluateTextingQuietHours,
  nextAllowedTextingTime,
  parseE164Phone,
  parseTwilioOptOutType,
  twilioStatusToDeliveryState,
} from './texting';

describe('governed texting domain', () => {
  it('requires an exact E.164 recipient and never guesses a country', () => {
    expect(parseE164Phone('+12025550123')).toBe('+12025550123');
    expect(() => parseE164Phone('2025550123')).toThrow(/E\.164/);
  });

  it('evaluates overnight quiet hours in the verified recipient timezone including DST dates', () => {
    expect(evaluateTextingQuietHours({
      startLocal: '20:00', endLocal: '08:00', recipientTimeZone: 'America/New_York', policyVersion: 'policy-1',
    }, new Date('2026-03-08T11:30:00Z'))).toMatchObject({ allowed: false, localMinute: 450 });
    expect(evaluateTextingQuietHours({
      startLocal: '20:00', endLocal: '08:00', recipientTimeZone: 'America/New_York', policyVersion: 'policy-1',
    }, new Date('2026-03-08T16:30:00Z'))).toMatchObject({ allowed: true, localMinute: 750 });
    expect(() => evaluateTextingQuietHours({
      startLocal: '20:00', endLocal: '08:00', recipientTimeZone: 'unknown', policyVersion: 'policy-1',
    })).toThrow(/verified recipient timezone/);
  });

  it('resolves the first permitted instant from the IANA timezone across DST', () => {
    const policy = {
      startLocal: '20:00', endLocal: '08:00', recipientTimeZone: 'America/New_York', policyVersion: 'policy-1',
    } as const;
    expect(nextAllowedTextingTime(policy, new Date('2026-03-08T06:30:00Z')).toISOString())
      .toBe('2026-03-08T12:00:00.000Z');
    expect(nextAllowedTextingTime(policy, new Date('2026-11-01T05:30:00Z')).toISOString())
      .toBe('2026-11-01T13:00:00.000Z');
  });

  it('uses Twilio authoritative STOP, START and HELP classifications', () => {
    expect(parseTwilioOptOutType('stop')).toBe('STOP');
    expect(consentStatusForTwilioKeyword('STOP')).toBe('opted_out');
    expect(consentStatusForTwilioKeyword('START')).toBe('opted_in');
    expect(consentStatusForTwilioKeyword('HELP')).toBeUndefined();
    expect(() => parseTwilioOptOutType('unsubscribe')).toThrow(/unsupported/);
  });

  it('keeps delivery state monotonic and final outcomes immutable', () => {
    expect(twilioStatusToDeliveryState('delivered')).toBe('delivered');
    expect(() => assertTextingDeliveryTransition('sent', 'queued')).toThrow(/cannot regress/);
    expect(() => assertTextingDeliveryTransition('delivered', 'undelivered')).toThrow(/final outcome/);
    expect(() => assertTextingDeliveryTransition('sending', 'sent')).not.toThrow();
  });
});
