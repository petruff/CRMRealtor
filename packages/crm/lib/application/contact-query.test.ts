import { describe, expect, it } from 'vitest';
import type { Contact } from '../domain/contact';
import {
  CONTACT_QUERY_MAX,
  normalizeContactQuery,
  parseContactScope,
  parseLeadSource,
  parseLeadType,
  queryArchivedContacts,
  queryContacts,
} from './contact-query';

const base: Omit<Contact, 'id' | 'firstName' | 'lastName' | 'leadType'> = {
  relationship: 'lead',
  intent: 'unknown',
  source: 'other',
  pipelineStage: 'new',
  tags: [],
  createdAt: '2026-08-11T00:00:00.000Z',
  emailSubscribed: true,
};

function contact(
  id: string,
  firstName: string,
  leadType: Contact['leadType'],
  patch: Partial<Contact> = {},
): Contact {
  return { ...base, id, firstName, lastName: 'Person', leadType, ...patch };
}

describe('contact query', () => {
  const contacts = [
    contact('n-1', 'Nora', 'nurture', { tags: ['Past Client'] }),
    contact('h-1', 'José', 'hot', { preferredName: 'Pepe', phone: '(404) 555-0199' }),
    contact('w-1', 'Willow', 'warm', { email: 'willow@example.com', city: 'Decatur', postalCode: '30030' }),
    contact('h-2', 'Harper', 'hot'),
  ];

  it('normalizes case, whitespace, and diacritics and searches preferred or legal names', () => {
    expect(normalizeContactQuery('  JOSÉ   ')).toBe('jose');
    expect(queryContacts(contacts, { query: 'jose' }).map((item) => item.id)).toEqual(['h-1']);
    expect(queryContacts(contacts, { query: 'PEPE' }).map((item) => item.id)).toEqual(['h-1']);
  });

  it('searches phones, email, city, postal code, and tags', () => {
    expect(queryContacts(contacts, { query: '404555' }).map((item) => item.id)).toEqual(['h-1']);
    expect(queryContacts(contacts, { query: 'example.com decatur' }).map((item) => item.id)).toEqual(['w-1']);
    expect(queryContacts(contacts, { query: '30030' }).map((item) => item.id)).toEqual(['w-1']);
    expect(queryContacts(contacts, { query: 'past client' }).map((item) => item.id)).toEqual(['n-1']);
  });

  it('filters lead type and preserves hot, warm, nurture order plus stable source order', () => {
    expect(queryContacts(contacts).map((item) => item.id)).toEqual(['h-1', 'h-2', 'w-1', 'n-1']);
    expect(queryContacts(contacts, { leadType: 'hot' }).map((item) => item.id)).toEqual(['h-1', 'h-2']);
    const referral = contact('referral', 'Rae', 'warm', { source: 'referral' });
    expect(queryContacts([...contacts, referral], { scope: 'all', source: 'referral' }).map((item) => item.id)).toEqual(['referral']);
    expect(parseLeadSource('referral')).toBe('referral');
    expect(() => parseLeadSource('paid-search')).toThrow('source');
  });

  it('returns no matches and rejects malformed bounds or lead types', () => {
    expect(queryContacts(contacts, { query: 'not-here' })).toEqual([]);
    expect(() => queryContacts(contacts, { query: 'x'.repeat(CONTACT_QUERY_MAX + 1) })).toThrow('200');
    expect(parseLeadType(undefined)).toBeUndefined();
    expect(parseLeadType('warm')).toBe('warm');
    expect(() => parseLeadType('urgent')).toThrow('hot, warm, or nurture');
  });

  it('does not apply the user-query bound to stored searchable contact data', () => {
    const longContact = contact('h-long', 'Harper', 'hot', {
      tags: ['x'.repeat(CONTACT_QUERY_MAX + 1), 'Open House'],
    });
    expect(queryContacts([longContact], { query: 'open house' }).map((item) => item.id))
      .toEqual(['h-long']);
  });

  it('supports the six active scopes without changing lead temperature', () => {
    const scoped = [
      contact('lead', 'Lead', 'hot', { relationship: 'lead' }),
      contact('sphere', 'Sphere', 'warm', { relationship: 'sphere' }),
      contact('active', 'Active', 'nurture', { relationship: 'active-client' }),
      contact('past', 'Past', 'hot', { relationship: 'past-client' }),
      contact('review-client', 'Review', 'warm', {
        relationship: 'active-client', qualificationStatus: 'needs-qualification',
      }),
    ];
    expect(queryContacts(scoped).map((item) => item.id)).toEqual(['lead', 'sphere']);
    expect(queryContacts(scoped, { scope: 'clients' }).map((item) => item.id)).toEqual(['past', 'review-client', 'active']);
    expect(queryContacts(scoped, { scope: 'active-clients' }).map((item) => item.id)).toEqual(['review-client', 'active']);
    expect(queryContacts(scoped, { scope: 'past-clients' }).map((item) => item.id)).toEqual(['past']);
    expect(queryContacts(scoped, { scope: 'needs-review' }).map((item) => item.id)).toEqual(['review-client']);
    expect(queryContacts(scoped, { scope: 'all' }).map((item) => item.id)).toEqual([
      'lead', 'past', 'sphere', 'review-client', 'active',
    ]);
  });

  it('composes scope, search, and lead type and rejects invalid scopes', () => {
    const scoped = [
      contact('active-hot', 'Judith', 'hot', { relationship: 'active-client', city: 'Vero Beach' }),
      contact('active-warm', 'Judith', 'warm', { relationship: 'active-client', city: 'Vero Beach' }),
      contact('lead-hot', 'Judith', 'hot', { relationship: 'lead', city: 'Vero Beach' }),
    ];
    expect(queryContacts(scoped, {
      scope: 'clients', query: 'vero beach', leadType: 'hot',
    }).map((item) => item.id)).toEqual(['active-hot']);
    expect(parseContactScope(undefined)).toBe('leads');
    expect(parseContactScope('clients')).toBe('clients');
    expect(() => parseContactScope('customers')).toThrow('Contact scope must be one of');
  });

  it('keeps archived records out of active scopes and only in the archived seam', () => {
    const archived = contact('archived', 'Archived', 'hot', {
      relationship: 'lead', archivedAt: '2026-08-18T10:00:00.000Z',
    });
    expect(queryContacts([archived], { scope: 'all' })).toEqual([]);
    expect(queryArchivedContacts([archived]).map((item) => item.id)).toEqual(['archived']);
  });
});
