import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIP_QUEUE_BATCH_SIZE,
  INITIAL_QUEUE_STATE,
  RelationshipQueue,
  applyQueueQuery,
  changeQueueCriteria,
  classifyQueueState,
  filterQueueEntries,
  getEligibleContactIds,
  getScopeEntries,
  isMomentEntryType,
  nextVisibleCount,
} from '@/components/relationship-queue';
import type { Contact } from '@/lib/domain/contact';
import { buildTriage, type TriageEntry } from '@/lib/domain/triage';

const AS_OF = new Date('2026-08-13T14:00:00.000Z');

function contact(index: number, overrides: Partial<Contact> = {}): Contact {
  return {
    id: `contact-${index}`,
    firstName: `Queue${index}`,
    lastName: 'Person',
    phone: `+1 410 555 ${String(index).padStart(4, '0')}`,
    email: `queue${index}@example.com`,
    city: 'Baltimore',
    postalCode: '21201',
    tags: ['open-house'],
    leadType: index % 3 === 0 ? 'hot' : index % 3 === 1 ? 'warm' : 'nurture',
    relationship: 'lead',
    intent: 'buyer',
    source: 'open-house',
    pipelineStage: 'new',
    createdAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    ...overrides,
  };
}

describe('RelationshipQueue', () => {
  it('mounts only the first 12 of a 90-contact Now fixture and preserves contact CTAs', () => {
    const contacts = Array.from({ length: 90 }, (_, index) => contact(index));
    const html = renderToStaticMarkup(
      <RelationshipQueue contacts={contacts} buckets={buildTriage(contacts, AS_OF)} />,
    );

    expect((html.match(/<article/g) ?? [])).toHaveLength(RELATIONSHIP_QUEUE_BATCH_SIZE);
    expect(html).toContain('Showing 12 of 90 in Now');
    expect(html).toContain('Show next 12 (78 remaining)');
    expect(html).toContain('role="tabpanel"');
    expect((html.match(/role="tabpanel"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('aria-label="Call ');
    expect(html).toContain('aria-label="Text ');
    expect(html).toContain('aria-label="Email ');
    expect(html).not.toContain('Mark as contacted');
  });

  it('maps scopes and Now subfilters without disturbing buildTriage order', () => {
    const contacts = [
      contact(1),
      contact(2, { lastContactedAt: '2026-08-01T12:00:00.000Z', nextTouchAt: '2026-08-10', touchDateOverridden: true }),
      contact(3, { lastContactedAt: '2026-08-01T12:00:00.000Z', nextTouchAt: '2026-08-13', touchDateOverridden: true }),
      contact(4, { lastContactedAt: '2026-08-01T12:00:00.000Z', nextTouchAt: '2026-08-16', touchDateOverridden: true }),
      contact(5, { birthdate: '1980-08-13', lastContactedAt: '2026-08-12T12:00:00.000Z', nextTouchAt: '2026-09-01', touchDateOverridden: true }),
    ];
    const buckets = buildTriage(contacts, AS_OF);
    const nowExpected = ['needs-first-contact', 'overdue', 'due-today'].flatMap(
      (id) => buckets.find((bucket) => bucket.id === id)?.entries ?? [],
    );

    expect(getScopeEntries(buckets, 'now').map((entry) => entry.contact.id)).toEqual(
      nowExpected.map((entry) => entry.contact.id),
    );
    expect(getScopeEntries(buckets, 'now', 'overdue').map((entry) => entry.contact.id)).toEqual(['contact-2']);
    expect(getScopeEntries(buckets, 'moments').map((entry) => entry.contact.id)).toEqual(['contact-5']);
    expect(getScopeEntries(buckets, 'next-seven-days').map((entry) => entry.contact.id)).toEqual(['contact-4']);
  });

  it('filters Moments by structured birthday and home-purchase facts while preserving order', () => {
    const dualMoment = contact(10, {
      birthdate: '1980-08-13',
      homePurchaseDate: '2018-08-13',
      lastContactedAt: '2026-08-12T12:00:00.000Z',
      nextTouchAt: '2026-09-01',
      touchDateOverridden: true,
    });
    const birthdayOnly = contact(11, {
      birthdate: '1985-08-14',
      lastContactedAt: '2026-08-12T12:00:00.000Z',
      nextTouchAt: '2026-09-01',
      touchDateOverridden: true,
    });
    const buckets = buildTriage([dualMoment, birthdayOnly], AS_OF);
    const allMoments = getScopeEntries(buckets, 'moments');
    const birthdays = getScopeEntries(buckets, 'moments', 'all', 'birthday');
    const homeaversaries = getScopeEntries(buckets, 'moments', 'all', 'homeaversary');

    expect(allMoments).toHaveLength(3);
    expect(birthdays.map((entry) => entry.contact.id)).toEqual(['contact-10', 'contact-11']);
    expect(homeaversaries.map((entry) => entry.contact.id)).toEqual(['contact-10']);
    expect(birthdays.every((entry) => isMomentEntryType(entry, 'birthday'))).toBe(true);
    expect(homeaversaries.every((entry) => isMomentEntryType(entry, 'homeaversary'))).toBe(true);
  });

  it.each([
    ['name', 'alvaro'],
    ['phone', '0199'],
    ['email', 'special@example.com'],
    ['city', 'annapolis'],
    ['ZIP', '21401'],
    ['tag', 'luxury'],
  ])('reuses contact-query membership for %s', (_field, query) => {
    const contacts = [contact(98), contact(99, {
      firstName: 'Álvaro',
      phone: '+1 (410) 555-0199',
      email: 'special@example.com',
      city: 'Annapolis',
      postalCode: '21401',
      tags: ['luxury'],
    })];
    expect([...getEligibleContactIds(contacts, query, 'all')]).toEqual(['contact-99']);
  });

  it('uses queryContacts only for membership and retains incoming triage priority', () => {
    const warm = contact(1, { leadType: 'warm', tags: ['shared'] });
    const hot = contact(2, { leadType: 'hot', tags: ['shared'] });
    const entries: TriageEntry[] = [
      { contact: warm, score: 20, reason: 'First', daysOverdue: 2 },
      { contact: hot, score: 10, reason: 'Second', daysOverdue: 1 },
    ];
    const eligible = getEligibleContactIds([warm, hot], 'shared', 'all');

    expect(filterQueueEntries(entries, eligible).map((entry) => entry.contact.id)).toEqual([
      'contact-1',
      'contact-2',
    ]);
    expect([...getEligibleContactIds([warm, hot], '', 'hot')]).toEqual(['contact-2']);
  });

  it('reveals exact batches and caps the final partial batch', () => {
    expect(nextVisibleCount(12, 37)).toBe(24);
    expect(nextVisibleCount(24, 37)).toBe(36);
    expect(nextVisibleCount(36, 37)).toBe(37);
    let visible = RELATIONSHIP_QUEUE_BATCH_SIZE;
    while (visible < 90) visible = nextVisibleCount(visible, 90);
    expect(visible).toBe(90);
  });

  it('distinguishes empty, no-results, populated, and all-shown states', () => {
    expect(classifyQueueState(0, 0)).toBe('empty');
    expect(classifyQueueState(8, 0)).toBe('no-results');
    expect(classifyQueueState(8, 3)).toBe('results');

    const contacts = [contact(1), contact(2)];
    const html = renderToStaticMarkup(
      <RelationshipQueue contacts={contacts} buckets={buildTriage(contacts, AS_OF)} />,
    );
    expect(html).toContain('All 2 shown');
    expect(html).not.toContain('Show next');
  });

  it('exposes semantic, keyboard-ready controls and rejects overlong shared queries', () => {
    const contacts = [contact(1)];
    const html = renderToStaticMarkup(
      <RelationshipQueue contacts={contacts} buckets={buildTriage(contacts, AS_OF)} />,
    );

    expect(html).toContain('role="search"');
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? [])).toHaveLength(3);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-live="polite"');
    expect((html.match(/aria-controls="relationship-queue-panel"/g) ?? [])).toHaveLength(3);
    expect((html.match(/id="relationship-queue-panel"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('aria-controls="relationship-queue-panel-moments"');
    expect(() => getEligibleContactIds(contacts, 'x'.repeat(201), 'all')).toThrow('200 characters or fewer');
  });

  it('drives populated batching beyond 100 entries and resets every changed criterion', () => {
    let state = { ...INITIAL_QUEUE_STATE };
    while (state.visibleCount < 109) {
      state = { ...state, visibleCount: nextVisibleCount(state.visibleCount, 109) };
    }
    expect(state.visibleCount).toBe(109);

    for (const patch of [
      { scope: 'moments' as const },
      { nowFilter: 'overdue' as const },
      { momentFilter: 'birthday' as const },
      { leadFilter: 'hot' as const },
      { appliedQuery: 'queue' },
    ]) {
      state = { ...state, visibleCount: 48 };
      state = changeQueueCriteria(state, patch);
      expect(state.visibleCount).toBe(RELATIONSHIP_QUEUE_BATCH_SIZE);
    }

    const sharedFilters = changeQueueCriteria(INITIAL_QUEUE_STATE, {
      appliedQuery: 'Baltimore',
      leadFilter: 'warm',
    });
    const switchedScope = changeQueueCriteria(sharedFilters, {
      scope: 'moments',
      nowFilter: 'all',
      momentFilter: 'all',
    });
    expect(switchedScope.appliedQuery).toBe('Baltimore');
    expect(switchedScope.leadFilter).toBe('warm');
  });

  it('preserves the last valid result state when an invalid query is submitted', () => {
    const valid = applyQueueQuery({ ...INITIAL_QUEUE_STATE, visibleCount: 36 }, 'Baltimore');
    expect(valid.error).toBe('');
    expect(valid.state.appliedQuery).toBe('Baltimore');
    expect(valid.state.visibleCount).toBe(RELATIONSHIP_QUEUE_BATCH_SIZE);

    const invalid = applyQueueQuery(valid.state, 'x'.repeat(201));
    expect(invalid.error).toContain('200 characters or fewer');
    expect(invalid.state).toEqual(valid.state);
  });

  it('renders populated no-results recovery, Moments controls, and state-specific live announcements', () => {
    const contacts = [
      contact(1),
      contact(2, {
        birthdate: '1980-08-13',
        lastContactedAt: '2026-08-12T12:00:00.000Z',
        nextTouchAt: '2026-09-01',
        touchDateOverridden: true,
      }),
    ];
    const buckets = buildTriage(contacts, AS_OF);
    const noResultsState = changeQueueCriteria(INITIAL_QUEUE_STATE, { appliedQuery: 'not-present' });
    const noResultsHtml = renderToStaticMarkup(
      <RelationshipQueue contacts={contacts} buckets={buckets} initialState={noResultsState} />,
    );
    expect(noResultsHtml).toContain('No matches in Now');
    expect(noResultsHtml).toContain('Clear search');
    expect(noResultsHtml).toContain('Now, 0 results, showing 0.');

    const momentsState = changeQueueCriteria(INITIAL_QUEUE_STATE, { scope: 'moments' });
    const momentsHtml = renderToStaticMarkup(
      <RelationshipQueue contacts={contacts} buckets={buckets} initialState={momentsState} />,
    );
    expect(momentsHtml).toContain('aria-label="Moment type"');
    expect(momentsHtml).toContain('All moments');
    expect(momentsHtml).toContain('Birthdays');
    expect(momentsHtml).toContain('Homeaversaries');
    expect(momentsHtml).toContain('Moments, 1 result, showing 1.');
  });

  it('renders final-batch status and announcement for a 37-entry populated state', () => {
    const contacts = Array.from({ length: 37 }, (_, index) => contact(index));
    const state = { ...INITIAL_QUEUE_STATE, visibleCount: 37 };
    const html = renderToStaticMarkup(
      <RelationshipQueue contacts={contacts} buckets={buildTriage(contacts, AS_OF)} initialState={state} />,
    );
    expect((html.match(/<article/g) ?? [])).toHaveLength(37);
    expect(html).toContain('All 37 shown');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Now, 37 results, showing 37.');
  });
});
