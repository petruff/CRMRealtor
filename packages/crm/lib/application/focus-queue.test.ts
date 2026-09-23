import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import { buildTriage } from '@/lib/domain/triage';
import { buildFocusMoments, buildFocusQueue } from './focus-queue';

const NOW = new Date('2026-09-23T15:00:00.000Z');
const person = (id: string, patch: Partial<Contact> = {}): Contact => ({
  id, firstName: id, lastName: 'Lane', leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'other',
  pipelineStage: 'contacted', tags: [], createdAt: '2026-08-01T00:00:00.000Z', lastContactedAt: '2026-09-03', nextTouchAt: '2026-10-01', ...patch,
});

describe('focus queue', () => {
  it('orders new leads first, then most overdue, then due today — each person once', () => {
    const buckets = buildTriage([
      person('Due', { nextTouchAt: '2026-09-23' }),
      person('Late', { nextTouchAt: '2026-09-03', leadType: 'hot' }),
      person('Fresh', { source: 'open-house', lastContactedAt: undefined, nextTouchAt: undefined, pipelineStage: 'new', createdAt: '2026-09-20T12:00:00.000Z' }),
      person('Later', { nextTouchAt: '2026-09-28' }),
    ], NOW);
    const queue = buildFocusQueue(buckets, NOW);
    expect(queue.map((item) => item.contactId)).toEqual(['Fresh', 'Late', 'Due']);
    expect(queue.map((item) => item.kind)).toEqual(['first-contact', 'overdue', 'due-today']);
  });

  it('explains why in plain words with US dates, never ISO', () => {
    const buckets = buildTriage([
      person('Late', { nextTouchAt: '2026-09-03', lastContactedAt: '2026-08-27', city: 'Tampa', buyer: { priceMax: 650000 } }),
      person('Fresh', { source: 'open-house', lastContactedAt: undefined, nextTouchAt: undefined, pipelineStage: 'new', createdAt: '2026-09-20T12:00:00.000Z' }),
    ], NOW);
    const [fresh, late] = buildFocusQueue(buckets, NOW);
    expect(fresh!.why).toBe('New open house lead, waiting 3 days for a first call');
    expect(late!.why).toBe('Follow-up 20 days overdue · last spoke Thu, Aug 27');
    expect(late!.context).toBe('Buyer · Contacted · up to $650k · Tampa');
    expect(`${fresh!.why} ${late!.why}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('lists upcoming birthdays and home anniversaries soonest first', () => {
    const buckets = buildTriage([
      person('Bday', { birthdate: '1980-09-26' }),
      person('Home', { homePurchaseDate: '2021-10-04', relationship: 'past-client' }),
    ], NOW);
    const moments = buildFocusMoments(buckets, NOW);
    expect(moments.map((moment) => moment.label)).toEqual(['Birthday in 3 days', '5th home anniversary in 11 days']);
  });
});
