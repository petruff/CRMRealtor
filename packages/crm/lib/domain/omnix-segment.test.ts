import { describe, expect, it } from 'vitest';
import type { Contact } from './contact.ts';
import { applySegment, daysUntilAnnual, describeSegment, OmnixSegmentError, parseSegmentQuery, segmentQuery } from './omnix-segment.ts';

function contact(id: string, extra: Partial<Contact> = {}): Contact {
  return {
    id, firstName: id, lastName: 'Test', leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'website', pipelineStage: 'contacted',
    tags: [], createdAt: '2026-01-01T12:00:00.000Z', ...extra,
  };
}

const today = '2026-09-24';

describe('Omnix segments', () => {
  it('round-trips the canonical form and rejects anything else', () => {
    const filter = { leadType: 'hot', intent: 'buyer', city: 'Round Rock', noContactDays: 14, preApproved: true } as const;
    expect(segmentQuery(filter)).toBe('segment leadType=hot; intent=buyer; city=Round Rock; noContactDays=14; preApproved=yes');
    expect(parseSegmentQuery(segmentQuery(filter))).toEqual(filter);
    expect(parseSegmentQuery('segment all')).toEqual({});
    for (const bad of ['segment leadType=scorching', 'segment drop=table', 'segment noContactDays=-3', 'segment city=<script>', 'segment leadType=hot; leadType=warm', 'segment count=no']) {
      expect(() => parseSegmentQuery(bad)).toThrow(OmnixSegmentError);
    }
    expect(parseSegmentQuery('pipeline')).toBeUndefined();
  });

  it('filters by heat, intent, place and quiet time — never archived people', () => {
    const contacts = [
      contact('quiet-hot', { leadType: 'hot', lastContactedAt: '2026-09-01T12:00:00.000Z', city: 'Round Rock' }),
      contact('recent-hot', { leadType: 'hot', lastContactedAt: '2026-09-22T12:00:00.000Z', city: 'Round Rock' }),
      contact('never-hot', { leadType: 'hot', buyer: { areas: ['Round Rock'] } }),
      contact('seller-hot', { leadType: 'hot', intent: 'seller', city: 'Round Rock' }),
      contact('archived', { leadType: 'hot', city: 'Round Rock', archivedAt: '2026-09-01T00:00:00.000Z' }),
    ];
    const matches = applySegment(contacts, { leadType: 'hot', intent: 'buyer', city: 'round rock', noContactDays: 7 }, today);
    expect(matches.map((item) => item.contact.id)).toEqual(['never-hot', 'quiet-hot']);
    expect(matches[1]?.reasons).toEqual(['Last talked 23 days ago']);
    expect(matches[0]?.reasons).toEqual(['Never contacted']);
  });

  it('finds upcoming birthdays and home anniversaries, soonest first', () => {
    const contacts = [
      contact('later', { birthdate: '1980-10-20' }),
      contact('soon', { birthdate: '1990-09-26' }),
      contact('today', { birthdate: '1985-09-24' }),
      contact('home', { homePurchaseDate: '2021-10-01' }),
    ];
    expect(applySegment(contacts, { birthdayWithinDays: 7 }, today).map((item) => [item.contact.id, item.reasons[0]]))
      .toEqual([['today', 'Birthday today'], ['soon', 'Birthday in 2 days']]);
    expect(applySegment(contacts, { anniversaryWithinDays: 30 }, today).map((item) => item.contact.id)).toEqual(['home']);
    expect(daysUntilAnnual('2000-02-29', '2027-02-27')).toBe(2);
    expect(daysUntilAnnual('1990-01-02', '2026-12-30')).toBe(3);
  });

  it('finds new people and due follow-ups', () => {
    const contacts = [
      contact('new', { createdAt: '2026-09-22T15:00:00.000Z' }),
      contact('old'),
      contact('due', { nextTouchAt: '2026-09-20' }),
      contact('future', { nextTouchAt: '2026-10-20' }),
    ];
    expect(applySegment(contacts, { newWithinDays: 7 }, today).map((item) => [item.contact.id, item.reasons[0]])).toEqual([['new', 'Added 2 days ago']]);
    expect(applySegment(contacts, { followUpDue: true }, today).map((item) => [item.contact.id, item.reasons[0]])).toEqual([['due', 'Follow-up 4 days overdue']]);
  });

  it('describes segments in plain English', () => {
    expect(describeSegment({ leadType: 'hot', intent: 'buyer', noContactDays: 7 })).toBe('hot buyers not contacted in 7+ days');
    expect(describeSegment({ birthdayWithinDays: 7 })).toBe('people with a birthday in the next 7 days');
    expect(describeSegment({ relationship: 'lead', source: 'website' })).toBe('leads from your website');
    expect(describeSegment({})).toBe('contacts');
  });
});
