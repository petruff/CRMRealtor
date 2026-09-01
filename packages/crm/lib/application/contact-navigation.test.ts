import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import {
  contactBrowseSequence,
  contactEditHref,
  contactListHref,
  contactRecordHref,
  contactRecordNavigation,
  parseContactBrowseContext,
} from '@/lib/application/contact-navigation';

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
});
