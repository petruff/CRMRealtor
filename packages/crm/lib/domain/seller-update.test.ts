import { describe, expect, it } from 'vitest';
import type { Contact } from './contact.ts';
import { isActiveSeller, isSellerUpdateDay, sellerUpdateDraft, sellerUpdateDue, summarizeSellerWeek } from './seller-update.ts';

const now = new Date('2026-09-25T15:00:00.000Z'); // Friday

function seller(extra: Partial<Contact> = {}): Contact {
  return {
    id: 's1', firstName: 'Maria', lastName: 'Lopez', leadType: 'hot', relationship: 'active-client', intent: 'seller', source: 'referral',
    pipelineStage: 'active', tags: [], createdAt: '2026-06-01T12:00:00.000Z', phone: '(305) 555-0100', seller: { propertyAddress: '123 Palm Ave' }, ...extra,
  };
}

const note = (body: string, createdAt: string) => ({ body, createdAt });

describe('seller update', () => {
  it('knows who is an active seller', () => {
    expect(isActiveSeller(seller())).toBe(true);
    expect(isActiveSeller(seller({ intent: 'both', relationship: 'lead', pipelineStage: 'under-contract' }))).toBe(true);
    expect(isActiveSeller(seller({ intent: 'both', relationship: 'lead', pipelineStage: 'under-contract', seller: undefined }))).toBe(false);
    expect(isActiveSeller(seller({ seller: { propertyAddress: '123 Palm Ave', listingStatus: 'Sold' } }))).toBe(false);
    expect(isActiveSeller(seller({ seller: { propertyAddress: '123 Palm Ave', listingStatus: 'Withdrawn' } }))).toBe(false);
    expect(isActiveSeller(seller({ intent: 'buyer' }))).toBe(false);
    expect(isActiveSeller(seller({ pipelineStage: 'closed' }))).toBe(false);
    expect(isActiveSeller(seller({ relationship: 'lead', pipelineStage: 'contacted' }))).toBe(false);
    // An "active" seller lead without a listed property is a prospect, not a listing.
    expect(isActiveSeller(seller({ relationship: 'lead', pipelineStage: 'active', seller: undefined }))).toBe(false);
    expect(isActiveSeller(seller({ relationship: 'lead', pipelineStage: 'active', seller: { propertyAddress: '1 Main St' } }))).toBe(false);
    expect(isActiveSeller(seller({ relationship: 'lead', pipelineStage: 'active', seller: { propertyAddress: '1 Main St', listingStatus: 'Active' } }))).toBe(true);
    expect(isActiveSeller(seller({ archivedAt: '2026-09-01T00:00:00.000Z' }))).toBe(false);
  });

  it('counts this week’s activity from her notes and ignores older or archived ones', () => {
    const week = summarizeSellerWeek([
      note('Showing at 3pm went well, buyer feedback: loved the kitchen', '2026-09-23T18:00:00.000Z'),
      note('3 showings Saturday', '2026-09-20T18:00:00.000Z'),
      note('Open house Sunday, 12 visitors', '2026-09-21T18:00:00.000Z'),
      note('Showing last month', '2026-08-10T18:00:00.000Z'),
      { ...note('Showing archived', '2026-09-22T18:00:00.000Z'), archivedAt: '2026-09-22T19:00:00.000Z' },
      note('No offers yet', '2026-09-22T18:00:00.000Z'),
    ], now);
    expect(week).toMatchObject({ showings: 4, openHouses: 1, feedback: 1, offers: 0 });
    expect(week.evidence[0]).toBe('4 showings in your notes this week');
  });

  it('is due again six days after the last weekly update was marked sent', () => {
    const sent = summarizeSellerWeek([note('Texted: Hi Maria, your weekly update on 123 Palm Ave: …', '2026-09-18T15:00:00.000Z')], now);
    expect(sent.lastUpdateAt).toBe('2026-09-18T15:00:00.000Z');
    expect(sellerUpdateDue(sent, now)).toBe(true);
    const recent = summarizeSellerWeek([note('Texted: Hi Maria, your weekly update on 123 Palm Ave', '2026-09-24T15:00:00.000Z')], now);
    expect(sellerUpdateDue(recent, now)).toBe(false);
    expect(sellerUpdateDue(summarizeSellerWeek([], now), now)).toBe(true);
  });

  it('drafts a text with counts only, never note contents', () => {
    const week = summarizeSellerWeek([note('2 showings. Seller said she would take 600k, keep private. feedback: small yard', '2026-09-24T12:00:00.000Z')], now);
    const text = sellerUpdateDraft(seller(), week, 'Judith Smith');
    expect(text).toBe('Hi Maria, your weekly update on 123 Palm Ave: this week we had 2 showings. I’ll share the buyer feedback when we talk. Happy to talk through next steps anytime — call or text me. — Judith');
    expect(text).not.toMatch(/600k|private|small yard/u);
  });

  it('has a reassuring message for quiet weeks and for homes under contract', () => {
    expect(sellerUpdateDraft(seller({ seller: {} }), summarizeSellerWeek([], now))).toMatch(/^Hi Maria, your weekly update on your home: it was a quieter week/u);
    expect(sellerUpdateDraft(seller({ pipelineStage: 'under-contract' }), summarizeSellerWeek([], now))).toMatch(/under contract and moving toward closing/u);
  });

  it('runs on Fridays in her time zone', () => {
    expect(isSellerUpdateDay(now)).toBe(true);
    expect(isSellerUpdateDay(new Date('2026-09-26T02:00:00.000Z'))).toBe(true); // still Friday evening in Miami
    expect(isSellerUpdateDay(new Date('2026-09-24T15:00:00.000Z'))).toBe(false);
  });
});
