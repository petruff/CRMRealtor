import { describe, expect, it } from 'vitest';
import type { Contact } from '../domain/contact.ts';
import { buildReviveBatch, isReviveCandidate, reviveEmailDraft, reviveMailto, streetOf } from './revive-leads.ts';

const now = new Date('2026-09-24T15:00:00.000Z');

function lead(id: string, extra: Partial<Contact> = {}): Contact {
  return {
    id, firstName: id, lastName: 'Test', leadType: 'warm', relationship: 'lead', intent: 'unknown', source: 'other',
    pipelineStage: 'new', tags: [], createdAt: '2026-08-11T12:00:00.000Z', email: `${id.toLowerCase()}@example.com`, emailSubscribed: true, ...extra,
  };
}

describe('revive old leads', () => {
  it('only includes subscribed, unworked leads with a valid email', () => {
    expect(isReviveCandidate(lead('Ok'), now)).toBe(true);
    expect(isReviveCandidate(lead('Unsub', { emailSubscribed: false }), now)).toBe(false);
    expect(isReviveCandidate(lead('Unknown', { emailSubscribed: undefined }), now)).toBe(false);
    expect(isReviveCandidate(lead('NoEmail', { email: undefined }), now)).toBe(false);
    expect(isReviveCandidate(lead('Bad', { email: 'not-an-email' }), now)).toBe(false);
    expect(isReviveCandidate(lead('Client', { relationship: 'active-client' }), now)).toBe(false);
    expect(isReviveCandidate(lead('Active', { pipelineStage: 'active' }), now)).toBe(false);
    expect(isReviveCandidate(lead('Archived', { archivedAt: '2026-09-01T00:00:00.000Z' }), now)).toBe(false);
    expect(isReviveCandidate(lead('Recent', { pipelineStage: 'contacted', lastContactedAt: '2026-09-10T00:00:00.000Z' }), now)).toBe(false);
    expect(isReviveCandidate(lead('Brand new', { createdAt: '2026-09-20T12:00:00.000Z' }), now)).toBe(false);
    expect(isReviveCandidate(lead('Stale', { pipelineStage: 'contacted', lastContactedAt: '2026-08-01T00:00:00.000Z' }), now)).toBe(true);
  });

  it('reads the street from the mailing address without inventing one', () => {
    expect(streetOf({ mailingAddress: '1450 Sunset Dr, Coral Gables, FL 33143' })).toBe('1450 Sunset Dr');
    expect(streetOf({ mailingAddress: 'PO Box' })).toBeUndefined();
    expect(streetOf({})).toBeUndefined();
  });

  it('writes a seller email about their own home, with an opt-out and no market claims', () => {
    const draft = reviveEmailDraft(lead('Ana', { intent: 'seller', mailingAddress: '1450 Sunset Dr, Coral Gables', city: 'Coral Gables' }), 'Judith');
    expect(draft.subject).toBe('A quick question about 1450 Sunset Dr');
    expect(draft.body).toMatch(/^Hi Ana,\n\nThis is Judith, a local realtor\./u);
    expect(draft.body).toContain('free, no-obligation value update for 1450 Sunset Dr');
    expect(draft.body).toContain('reply “stop”');
    expect(draft.body).not.toMatch(/prices|sold for|hot market|getting attention/iu);
  });

  it('prefers the saved home-to-sell address over the mailing address', () => {
    expect(reviveEmailDraft(lead('Dan', { intent: 'seller', seller: { propertyAddress: '77 Alder Hollow, Doral' }, mailingAddress: '5 Other Rd' })).subject).toBe('A quick question about 77 Alder Hollow');
  });

  it('has buyer and general versions', () => {
    expect(reviveEmailDraft(lead('Bo', { intent: 'buyer' })).subject).toBe('Still looking for a home?');
    expect(reviveEmailDraft(lead('Cy')).subject).toBe('Are you still thinking about a move?');
    expect(reviveEmailDraft(lead('Cy')).body).toContain('I’m a local realtor.');
  });

  it('puts sellers with a known home first, then by temperature and age, ten per day', () => {
    const contacts = [
      lead('General', { leadType: 'hot' }),
      lead('SellerNoAddr', { intent: 'seller' }),
      lead('SellerNurture', { intent: 'seller', leadType: 'nurture', mailingAddress: '1 A St' }),
      lead('SellerHot', { intent: 'seller', leadType: 'hot', mailingAddress: '2 B St' }),
      lead('Buyer', { intent: 'buyer' }),
      ...Array.from({ length: 12 }, (_, index) => lead(`Filler${String(index).padStart(2, '0')}`, { leadType: 'nurture' })),
    ];
    const batch = buildReviveBatch({ contacts, now, agentName: 'Judith' });
    expect(batch.eligible).toBe(17);
    expect(batch.items).toHaveLength(10);
    expect(batch.items.slice(0, 5).map((item) => item.contactId)).toEqual(['SellerHot', 'SellerNurture', 'SellerNoAddr', 'Buyer', 'General']);
    expect(batch.items[0]).toMatchObject({ angle: 'seller', why: 'Seller lead · added 44 days ago, never contacted', email: 'sellerhot@example.com' });
  });

  it('builds a mailto link with the subject and body encoded', () => {
    expect(reviveMailto('a@b.com', 'Hi & hello', 'Line 1\nLine 2')).toBe('mailto:a%40b.com?subject=Hi%20%26%20hello&body=Line%201%0ALine%202');
  });
});
