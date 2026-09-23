import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import {
  contactBrowseSequence,
  contactEditHref,
  contactListHref,
  contactRecordHref,
  contactRecordNavigation,
  contactBrowseQuery,
  parseContactBrowseContext,
  parseSerializedBrowseContext,
  resolveArchiveContinuation,
} from '@/lib/application/contact-navigation';
import { SMART_LIST_SCHEMA_VERSION } from '@/lib/domain/smart-list';

function contact(id: string, firstName: string, patch: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName,
    lastName: 'Person',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'unknown',
    source: 'other',
    pipelineStage: 'new',
    tags: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    ...patch,
  };
}

describe('contact record navigation', () => {
  it('moves deterministically through the originating relationship view', () => {
    const ada = contact('contact-a', 'Ada', { leadType: 'hot' });
    const judith = contact('contact-j', 'Judith');
    const zora = contact('contact-z', 'Zora', { leadType: 'nurture' });
    const past = contact('contact-p', 'Past', { relationship: 'past-client', leadType: 'hot' });
    const context = parseContactBrowseContext({ scope: 'leads' }, judith);
    const sequence = contactBrowseSequence([zora, past, judith, ada], context);

    expect(contactRecordNavigation(sequence, judith, context)).toMatchObject({
      position: 2,
      total: 3,
      currentMatches: true,
      previous: { id: 'contact-a' },
      next: { id: 'contact-z' },
    });
  });

  it('keeps a needs-review session inside the exact review queue', () => {
    const complete = contact('complete', 'Complete');
    const first = contact('review-a', 'Ada', { qualificationStatus: 'needs-qualification' });
    const second = contact('review-b', 'Bea', { qualificationStatus: 'needs-qualification' });
    const context = parseContactBrowseContext({ scope: 'needs-review' }, first);
    const sequence = contactBrowseSequence([complete, first, second], context);

    expect(sequence.map((entry) => entry.id)).toEqual(['review-a', 'review-b']);
    expect(contactRecordNavigation(sequence, first, context)).toMatchObject({
      position: 1,
      total: 2,
      next: { id: 'review-b' },
    });
  });

  it('offers the first remaining record when an edit removes the current contact from the view', () => {
    const completed = contact('review-a', 'Ada');
    const remaining = contact('review-b', 'Bea', { qualificationStatus: 'needs-qualification' });
    const context = parseContactBrowseContext({ scope: 'needs-review' }, completed);
    const sequence = contactBrowseSequence([completed, remaining], context);

    expect(contactRecordNavigation(sequence, completed, context)).toMatchObject({
      position: 0,
      total: 1,
      currentMatches: false,
      next: { id: 'review-b' },
    });
  });

  it('preserves filters, page, and archived context in every review link', () => {
    const current = contact('id with space', 'Ada', { archivedAt: '2026-09-01T13:00:00.000Z' });
    const context = parseContactBrowseContext({
      view: 'archived', q: 'Ada', leadType: 'warm', source: 'other', page: '2',
    }, current);

    expect(contactRecordHref(current.id, context)).toBe('/contacts/id%20with%20space?view=archived&q=Ada&leadType=warm&source=other&page=2');
    expect(contactEditHref(current.id, context)).toBe('/contacts/id%20with%20space/edit?view=archived&q=Ada&leadType=warm&source=other&page=2');
    expect(contactListHref(context)).toBe('/contacts?view=archived&q=Ada&leadType=warm&source=other&page=2');
  });

  it('keeps list origin in record links but never in the list link itself', () => {
    const current = contact('contact-b', 'Bea');
    const context = parseContactBrowseContext({ q: 'Bea', page: '2', from: 'list' }, current);

    expect(context.origin).toBe('list');
    expect(contactRecordHref(current.id, context)).toBe('/contacts/contact-b?q=Bea&page=2&from=list');
    expect(contactListHref(context)).toBe('/contacts?q=Bea&page=2');
    expect(parseContactBrowseContext({}, current).origin).toBeUndefined();
  });
});

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Missing fixture ${index}.`);
  return item;
}

describe('archive continuation', () => {
  const archivedAt = '2026-09-23T15:00:00.000Z';
  const leads = ['a', 'b', 'c', 'd'].map((id) => contact(`contact-${id}`, id.toUpperCase()));
  const archive = (items: Contact[], id: string) => items.map((entry) => (entry.id === id ? { ...entry, archivedAt } : entry));
  const listContext = parseContactBrowseContext({ from: 'list' }, at(leads, 0));

  it('opens the successor of a middle contact, not the previous one or itself', () => {
    const result = resolveArchiveContinuation(archive(leads, 'contact-b'), 'contact-b', listContext);

    expect(result).toEqual({ kind: 'next', contactId: 'contact-c', context: { scope: 'leads', origin: 'list' } });
  });

  it('preserves search, lead type, source and smart list filters', () => {
    const matching = [
      contact('h1', 'Hana', { leadType: 'hot', tags: ['pool'], source: 'website' }),
      contact('h2', 'Hana', { leadType: 'hot', tags: [], source: 'website' }),
      contact('h3', 'Hana', { leadType: 'hot', tags: ['pool'], source: 'other' }),
      contact('h4', 'Hana', { leadType: 'hot', tags: ['pool'], source: 'website' }),
    ];
    const context = parseContactBrowseContext({ q: 'hana', leadType: 'hot', source: 'website', smartList: 'list-1', from: 'list' }, at(matching, 0));
    const definition = { schemaVersion: SMART_LIST_SCHEMA_VERSION, criteria: [{ field: 'tags', operator: 'any', value: ['pool'] }] } as const;

    const result = resolveArchiveContinuation(archive(matching, 'h1'), 'h1', context, definition);

    expect(result).toMatchObject({ kind: 'next', contactId: 'h4', context: { query: 'hana', leadType: 'hot', source: 'website', smartList: 'list-1', origin: 'list' } });
  });

  it('crosses a page boundary without skipping a lead and recalculates the page', () => {
    const many = Array.from({ length: 5 }, (_, index) => contact(`p-${index}`, `P${index}`));
    const pageTwo = parseContactBrowseContext({ page: '1', from: 'list' }, at(many, 0));

    // Page size 2: [p0 p1] [p2 p3] [p4]. Archiving p1 (last on page 1) opens p2,
    // which moves to page 1 once p1 disappears.
    expect(resolveArchiveContinuation(archive(many, 'p-1'), 'p-1', pageTwo, undefined, 2))
      .toEqual({ kind: 'next', contactId: 'p-2', context: { scope: 'leads', origin: 'list' } });
    // Archiving p3 (last on page 2) opens p4, now the first of page 2 after removal.
    expect(resolveArchiveContinuation(archive(many, 'p-3'), 'p-3', { ...pageTwo, page: 2 }, undefined, 2))
      .toEqual({ kind: 'next', contactId: 'p-4', context: { scope: 'leads', origin: 'list', page: 2 } });
  });

  it('returns to the same active list when the last contact is archived, without wrapping', () => {
    const context = { ...listContext, query: 'a' };
    const result = resolveArchiveContinuation(archive(leads, 'contact-d'), 'contact-d', { ...listContext, page: 3 }, undefined, 2);

    expect(result).toEqual({ kind: 'list', context: { scope: 'leads', origin: 'list', page: 2 } });
    expect(resolveArchiveContinuation(archive(leads.slice(0, 1), 'contact-a'), 'contact-a', context))
      .toEqual({ kind: 'list', context });
  });

  it('skips a successor that was archived concurrently and falls back to the list when none remain', () => {
    const concurrently = archive(archive(leads, 'contact-b'), 'contact-c');

    expect(resolveArchiveContinuation(concurrently, 'contact-b', listContext)).toMatchObject({ kind: 'next', contactId: 'contact-d' });
    const allGone = archive(archive(concurrently, 'contact-d'), 'contact-b');
    expect(resolveArchiveContinuation(allGone, 'contact-b', listContext)).toMatchObject({ kind: 'list' });
  });

  it('does not invent a queue position for a contact outside the list context', () => {
    const client = contact('client', 'Cleo', { relationship: 'active-client' });
    const result = resolveArchiveContinuation(archive([...leads, client], 'client'), 'client', listContext);

    expect(result).toEqual({ kind: 'list', context: listContext });
  });

  it('accepts only a validated list context from the browser', () => {
    const current = at(leads, 1);

    expect(parseSerializedBrowseContext(contactBrowseQuery(listContext), current)).toEqual(listContext);
    expect(parseSerializedBrowseContext('scope=clients&q=Ana&from=list', current)).toEqual({ scope: 'clients', query: 'Ana', origin: 'list' });
    expect(parseSerializedBrowseContext('scope=leads', current)).toBeUndefined();
    expect(parseSerializedBrowseContext('view=archived&from=list', current)).toBeUndefined();
    expect(parseSerializedBrowseContext(undefined, current)).toBeUndefined();
    expect(parseSerializedBrowseContext(`from=list&q=${'x'.repeat(1_000)}`, current)).toBeUndefined();
    const hostile = parseSerializedBrowseContext('from=list&scope=https://evil.example&leadType=admin&page=-4', current);
    expect(hostile).toEqual({ scope: 'leads', origin: 'list' });
    expect(hostile && contactListHref(hostile)).toBe('/contacts');
  });
});
