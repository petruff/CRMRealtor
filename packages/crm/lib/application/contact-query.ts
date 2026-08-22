import { displayName, type Contact, type LeadType } from '../domain/contact.ts';

export const CONTACT_QUERY_MAX = 200;
export const CONTACT_LEAD_TYPES: readonly LeadType[] = ['hot', 'warm', 'nurture'];
export const CONTACT_SCOPES = [
  'leads',
  'clients',
  'active-clients',
  'past-clients',
  'needs-review',
  'all',
] as const;
export type ContactScope = (typeof CONTACT_SCOPES)[number];

export interface ContactQueryOptions {
  query?: string;
  leadType?: LeadType;
  scope?: ContactScope;
}

export class ContactQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactQueryError';
  }
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9@.+_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeContactQuery(value: string): string {
  if (value.length > CONTACT_QUERY_MAX) {
    throw new ContactQueryError(`Search query must be ${CONTACT_QUERY_MAX} characters or fewer.`);
  }
  return normalizeSearchValue(value);
}

export function parseLeadType(value: string | undefined): LeadType | undefined {
  if (!value) return undefined;
  if (CONTACT_LEAD_TYPES.includes(value as LeadType)) return value as LeadType;
  throw new ContactQueryError('Lead type must be hot, warm, or nurture.');
}

export function parseContactScope(value: string | undefined): ContactScope {
  if (!value) return 'leads';
  if (CONTACT_SCOPES.includes(value as ContactScope)) return value as ContactScope;
  throw new ContactQueryError(`Contact scope must be one of: ${CONTACT_SCOPES.join(', ')}.`);
}

function matchesScope(contact: Contact, scope: ContactScope): boolean {
  if (scope === 'all') return true;
  if (scope === 'leads') return contact.relationship === 'lead' || contact.relationship === 'sphere';
  if (scope === 'clients') {
    return contact.relationship === 'active-client' || contact.relationship === 'past-client';
  }
  if (scope === 'active-clients') return contact.relationship === 'active-client';
  if (scope === 'past-clients') return contact.relationship === 'past-client';
  return (contact.qualificationStatus ?? 'qualified') === 'needs-qualification';
}

function matchesQuery(contact: Contact, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const searchable = [
    displayName(contact),
    contact.firstName,
    contact.preferredName,
    contact.lastName,
    contact.email,
    contact.phone,
    contact.secondaryPhone,
    contact.city,
    contact.postalCode,
    ...contact.tags,
  ].filter((value): value is string => Boolean(value));
  // The public query is bounded; stored contact data may legitimately be longer.
  const haystack = normalizeSearchValue(searchable.join(' '));
  const digits = searchable.join(' ').replace(/\D/g, '');
  return normalizedQuery.split(' ').every((term) => {
    if (/^\d+$/.test(term) && term.length >= 3 && digits.includes(term)) return true;
    return haystack.includes(term);
  });
}

/** Shared deterministic query used by the CLI and server-rendered contacts route. */
export function queryContacts(
  contacts: readonly Contact[],
  options: ContactQueryOptions = {},
): Contact[] {
  const normalizedQuery = normalizeContactQuery(options.query ?? '');
  const scope = parseContactScope(options.scope);
  const rank = new Map(CONTACT_LEAD_TYPES.map((leadType, index) => [leadType, index]));
  return contacts
    .map((contact, index) => ({ contact, index }))
    .filter(({ contact }) =>
      !contact.archivedAt
      && matchesScope(contact, scope)
      && (!options.leadType || contact.leadType === options.leadType)
      && matchesQuery(contact, normalizedQuery))
    .sort((left, right) =>
      (rank.get(left.contact.leadType) ?? 99) - (rank.get(right.contact.leadType) ?? 99)
      || left.index - right.index)
    .map(({ contact }) => contact);
}

/** Archived records are intentionally queried through a separate read-only seam. */
export function queryArchivedContacts(
  contacts: readonly Contact[],
  options: Omit<ContactQueryOptions, 'scope'> = {},
): Contact[] {
  const normalizedQuery = normalizeContactQuery(options.query ?? '');
  const rank = new Map(CONTACT_LEAD_TYPES.map((leadType, index) => [leadType, index]));
  return contacts
    .map((contact, index) => ({ contact, index }))
    .filter(({ contact }) =>
      Boolean(contact.archivedAt)
      && (!options.leadType || contact.leadType === options.leadType)
      && matchesQuery(contact, normalizedQuery))
    .sort((left, right) =>
      (rank.get(left.contact.leadType) ?? 99) - (rank.get(right.contact.leadType) ?? 99)
      || left.index - right.index)
    .map(({ contact }) => contact);
}
