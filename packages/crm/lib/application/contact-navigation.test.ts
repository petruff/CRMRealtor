import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import {
  contactListHref,
  contactRecordHref,
  contactRecordNavigation,
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
  it('moves deterministically through the same working relationship scope', () => {
    const ada = contact('contact-a', 'Ada');
    const judith = contact('contact-j', 'Judith');
    const zora = contact('contact-z', 'Zora');
    const past = contact('contact-p', 'Past', { relationship: 'past-client', leadType: 'hot' });

    expect(contactRecordNavigation([zora, past, judith, ada], judith)).toMatchObject({
      scope: 'leads',
      position: 2,
      total: 3,
      previous: { id: 'contact-a' },
      next: { id: 'contact-z' },
    });
  });

  it('keeps past clients and archived records in their own sequences', () => {
    const first = contact('past-a', 'Ada', { relationship: 'past-client' });
    const second = contact('past-b', 'Bea', { relationship: 'past-client' });
    const archived = contact('archived-a', 'Archived', { archivedAt: '2026-09-01T13:00:00.000Z' });

    expect(contactRecordNavigation([archived, second, first], first)).toMatchObject({
      scope: 'past-clients', position: 1, total: 2, next: { id: 'past-b' },
    });
    expect(contactRecordNavigation([archived, second, first], archived)).toMatchObject({
      scope: 'archived', position: 1, total: 1,
    });
    expect(contactRecordHref('id with space', 'archived')).toBe('/contacts/id%20with%20space?view=archived');
    expect(contactListHref('past-clients')).toBe('/contacts?scope=past-clients');
  });
});
