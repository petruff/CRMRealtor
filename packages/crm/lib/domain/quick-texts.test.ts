import { describe, expect, it } from 'vitest';
import { QUICK_TEXT_KINDS, quickText, quickTextHref } from './quick-texts.ts';
import { lintFairHousing } from './fair-housing.ts';

describe('quick texts', () => {
  it('personalises every template in English and Spanish', () => {
    for (const { kind } of QUICK_TEXT_KINDS) {
      const en = quickText(kind, 'en', { firstName: 'Ana', agentName: 'Judith' });
      const es = quickText(kind, 'es', { firstName: 'Ana', agentName: 'Judith' });
      expect(en).toContain('Ana');
      expect(es).toContain('Ana');
      expect(en).toContain('Judith');
      expect(es).toContain('Judith');
      expect(en).not.toEqual(es);
      expect(en.length).toBeLessThan(320);
    }
  });

  it('signs with the agent’s first name only', () => {
    expect(quickText('new-lead', 'en', { firstName: 'Ana', agentName: 'Judith Smith' })).toContain('this is Judith!');
    expect(quickText('after-showing', 'en', { agentName: 'Judith Smith' })).toMatch(/— Judith$/u);
  });

  it('reads naturally without a name or agent', () => {
    expect(quickText('new-lead', 'en')).toBe('Hi! Thanks for reaching out. When’s a good time for a quick call about what you’re looking for?');
    expect(quickText('check-in', 'es')).not.toContain('undefined');
  });

  it('keeps wording Fair Housing clean', () => {
    for (const { kind } of QUICK_TEXT_KINDS) {
      for (const language of ['en', 'es'] as const) {
        expect(lintFairHousing(quickText(kind, language, { firstName: 'Ana' }))).toEqual([]);
      }
    }
  });

  it('builds sms links with an encoded body', () => {
    expect(quickTextHref('(305) 555-0101')).toBe('sms:3055550101');
    expect(quickTextHref('+1 305 555 0101', 'Hi & bye')).toBe('sms:+13055550101?&body=Hi%20%26%20bye');
    expect(quickTextHref('n/a')).toBeUndefined();
  });
});
