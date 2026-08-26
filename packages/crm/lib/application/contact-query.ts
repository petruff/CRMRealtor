import { SOURCE_LABEL, displayName, type Contact, type LeadSource, type LeadType } from '../domain/contact.ts';

export const CONTACT_QUERY_MAX = 200;
export const CONTACT_PAGE_SIZE = 50;
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
  source?: LeadSource;
  scope?: ContactScope;
}

export class ContactQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactQueryError';
  }
}

export function parseContactPage(value: string | undefined): number {
  if (!value) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function contactPageMetadata(total: number, requestedPage: number, pageSize = CONTACT_PAGE_SIZE) {
  if (!Number.isSafeInteger(total) || total < 0) throw new ContactQueryError('Contact total must be a positive integer or zero.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ContactQueryError('Contact page size must be from 1 to 100.');
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (page - 1) * pageSize;
  return {
    total,
    page,
    pageCount,
    offset,
    from: total ? offset + 1 : 0,
    to: Math.min(offset + pageSize, total),
  } as const;
}

export function paginateContacts<T>(items: readonly T[], requestedPage: number, pageSize = CONTACT_PAGE_SIZE) {
  const metadata = contactPageMetadata(items.length, requestedPage, pageSize);
  return {
    items: items.slice(metadata.offset, metadata.offset + pageSize),
    ...metadata,
  } as const;
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

export function parseLeadSource(value: string | undefined): LeadSource | undefined {
  if (!value) return undefined;
  if (value in SOURCE_LABEL) return value as LeadSource;
  throw new ContactQueryError('Lead source is invalid.');
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
      && (!options.source || contact.source === options.source)
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
      && (!options.source || contact.source === options.source)
      && matchesQuery(contact, normalizedQuery))
    .sort((left, right) =>
      (rank.get(left.contact.leadType) ?? 99) - (rank.get(right.contact.leadType) ?? 99)
      || left.index - right.index)
    .map(({ contact }) => contact);
}
