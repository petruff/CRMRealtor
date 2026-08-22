import { describe, expect, it } from 'vitest';
import { isMailingReady, missingMailingAddressFields, summarizeMailer } from './mailer';

describe('summarizeMailer', () => {
  const ready = (id: string) => ({
    id,
    mailingAddress: '10 Main St',
    city: 'Decatur',
    state: 'GA',
    postalCode: '30030',
  });

  it('requires every physical-mail address component and ignores whitespace', () => {
    expect(isMailingReady(ready('c-1'))).toBe(true);
    const incomplete = { ...ready('c-2'), city: ' ', postalCode: undefined };
    expect(isMailingReady(incomplete)).toBe(false);
    expect(missingMailingAddressFields(incomplete)).toEqual(['city', 'postalCode']);
  });

  it('counts unique currently eligible sends, incomplete addresses, and excludes removed contacts', () => {
    expect(
      summarizeMailer(
        [ready('c-1'), ready('c-2'), { ...ready('c-3'), postalCode: '' }],
        [
          { mailerId: 'm-1', contactId: 'c-1', sentOn: '2026-08-10' },
          { mailerId: 'm-1', contactId: 'c-1', sentOn: '2026-08-10' },
          { mailerId: 'm-1', contactId: 'c-3', sentOn: '2026-08-10' },
          { mailerId: 'm-1', contactId: 'removed', sentOn: '2026-08-10' },
        ],
      ),
    ).toEqual({ sent: 1, remaining: 1, total: 2, needsAddress: 1 });
  });
});
