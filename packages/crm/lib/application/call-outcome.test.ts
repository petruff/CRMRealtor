import { describe, expect, it } from 'vitest';
import { DEFAULT_FOLLOW_UP, callOutcomeNote, parseCallOutcome, shouldPromptForCall } from './call-outcome.ts';

describe('call outcome', () => {
  it('writes a short, readable timeline note', () => {
    expect(callOutcomeNote('talked', '  Wants to see Bayshore\r\nSaturday ')).toBe('Call — talked. Wants to see Bayshore\nSaturday');
    expect(callOutcomeNote('voicemail', '')).toBe('Call — left a voicemail.');
    expect(callOutcomeNote('no-answer', ' ')).toBe('Call — no answer.');
  });

  it('suggests a next step per outcome', () => {
    expect(DEFAULT_FOLLOW_UP).toEqual({ talked: 'cadence', voicemail: 'three-days', 'no-answer': 'tomorrow' });
  });

  it('parses only known outcomes', () => {
    expect(parseCallOutcome('voicemail')).toBe('voicemail');
    expect(parseCallOutcome('hung-up')).toBeUndefined();
  });

  it('asks only after leaving the app and coming back 5 seconds to 2 hours later', () => {
    const base = { contactId: 'c', name: 'Ana', startedAt: 1_000_000 };
    expect(shouldPromptForCall({ ...base, left: true }, 1_000_000 + 30_000)).toBe(true);
    expect(shouldPromptForCall({ ...base, left: false }, 1_000_000 + 30_000)).toBe(false);
    expect(shouldPromptForCall({ ...base, left: true }, 1_000_000 + 2_000)).toBe(false);
    expect(shouldPromptForCall({ ...base, left: true }, 1_000_000 + 3 * 60 * 60 * 1000)).toBe(false);
    expect(shouldPromptForCall(undefined, 1)).toBe(false);
  });
});
