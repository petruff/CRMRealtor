import {
  CONTACT_PAGE_SIZE,
  parseContactPage,
  parseContactScope,
  parseLeadSource,
  parseLeadType,
  queryArchivedContacts,
  queryContacts,
  type ContactScope,
} from '@/lib/application/contact-query';
import { contactViewHref } from '@/lib/application/contact-view-state';
import { applySmartListDefinition, type SmartListDefinitionV1 } from '@/lib/domain/smart-list';
import type { Contact, LeadSource, LeadType } from '@/lib/domain/contact';

export interface ContactBrowseContext {
  readonly archived?: boolean;
  readonly scope: ContactScope;
  readonly query?: string;
  readonly leadType?: LeadType;
  readonly source?: LeadSource;
  readonly smartList?: string;
  readonly page?: number;
  /**
   * Set only when the record was opened from an active contact list (or moved
   * through with Previous/Next). Direct links never claim a queue position.
   */
  readonly origin?: 'list';
}

export interface ContactRecordNavigation {
  readonly context: ContactBrowseContext;
  readonly position: number;
  readonly total: number;
  readonly currentMatches: boolean;
  readonly previous?: Contact;
  readonly next?: Contact;
}

type BrowseSearchParams = Readonly<{
  view?: string;
  scope?: string;
  q?: string;
  leadType?: string;
  source?: string;
  smartList?: string;
  page?: string;
  from?: string;
}>;

function fallbackScope(contact: Contact): ContactScope {
  if (contact.relationship === 'past-client') return 'past-clients';
  if (contact.relationship === 'active-client') return 'active-clients';
  return 'leads';
}

function optionalSmartList(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && candidate.length <= 200 ? candidate : undefined;
}

function optionalQuery(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && candidate.length <= 200 ? candidate : undefined;
}

function safeValue<T>(parse: () => T): T | undefined {
  try {
    return parse();
  } catch {
    return undefined;
  }
}

export function parseContactBrowseContext(
  params: BrowseSearchParams,
  current: Contact,
): ContactBrowseContext {
  const leadType = safeValue(() => parseLeadType(params.leadType));
  const source = safeValue(() => parseLeadSource(params.source));
  const page = parseContactPage(params.page);
  const query = optionalQuery(params.q);
  if (current.archivedAt || params.view === 'archived') {
    return {
      archived: true,
      scope: 'all',
      ...(query ? { query } : {}),
      ...(leadType ? { leadType } : {}),
      ...(source ? { source } : {}),
      ...(page > 1 ? { page } : {}),
    };
  }
  const scope = params.scope
    ? (safeValue(() => parseContactScope(params.scope)) ?? fallbackScope(current))
    : fallbackScope(current);
  const smartList = optionalSmartList(params.smartList);
  return {
    scope,
    ...(query ? { query } : {}),
    ...(leadType ? { leadType } : {}),
    ...(source ? { source } : {}),
    ...(smartList ? { smartList } : {}),
    ...(page > 1 ? { page } : {}),
    ...(params.from === 'list' ? { origin: 'list' as const } : {}),
  };
}

export function contactBrowseSequence(
  contacts: readonly Contact[],
  context: ContactBrowseContext,
  smartListDefinition?: SmartListDefinitionV1,
): Contact[] {
  const filtered = context.archived
    ? queryArchivedContacts(contacts, {
      query: context.query,
      leadType: context.leadType,
      source: context.source,
    })
    : queryContacts(contacts, {
      scope: context.scope,
      query: context.query,
      leadType: context.leadType,
      source: context.source,
    });
  return context.smartList && smartListDefinition
    ? applySmartListDefinition(filtered, smartListDefinition)
    : filtered;
}

export function contactRecordNavigation(
  orderedContacts: readonly Contact[],
  current: Contact,
  context: ContactBrowseContext,
): ContactRecordNavigation {
  const index = orderedContacts.findIndex((contact) => contact.id === current.id);
  if (index < 0) {
    return {
      context,
      position: 0,
      total: orderedContacts.length,
      currentMatches: false,
      ...(orderedContacts[0] ? { next: orderedContacts[0] } : {}),
    };
  }
  return {
    context,
    position: index + 1,
    total: orderedContacts.length,
    currentMatches: true,
    ...(index > 0 ? { previous: orderedContacts[index - 1] } : {}),
    ...(index + 1 < orderedContacts.length ? { next: orderedContacts[index + 1] } : {}),
  };
}

function browseParams(context: ContactBrowseContext): URLSearchParams {
  const params = new URLSearchParams();
  if (context.archived) params.set('view', 'archived');
  else if (context.scope !== 'leads') params.set('scope', context.scope);
  if (context.query) params.set('q', context.query);
  if (context.leadType) params.set('leadType', context.leadType);
  if (context.source) params.set('source', context.source);
  if (!context.archived && context.smartList) params.set('smartList', context.smartList);
  if (context.page && context.page > 1) params.set('page', String(context.page));
  if (!context.archived && context.origin === 'list') params.set('from', 'list');
  return params;
}

/** Serialized browse context for forms that must return to the same list. */
export function contactBrowseQuery(context: ContactBrowseContext): string {
  return browseParams(context).toString();
}

/** Reads an untrusted serialized browse context; anything without list origin is ignored. */
export function parseSerializedBrowseContext(
  raw: unknown,
  current: Contact,
): ContactBrowseContext | undefined {
  if (typeof raw !== 'string' || !raw || raw.length > 1_000) return undefined;
  const params = new URLSearchParams(raw);
  if (params.get('from') !== 'list' || params.get('view') === 'archived') return undefined;
  const single = (key: string) => params.get(key) ?? undefined;
  const context = parseContactBrowseContext({
    scope: single('scope'),
    q: single('q'),
    leadType: single('leadType'),
    source: single('source'),
    smartList: single('smartList'),
    page: single('page'),
    from: 'list',
  }, { ...current, archivedAt: undefined });
  return context.archived ? undefined : context;
}

export type ArchiveContinuation =
  | { readonly kind: 'next'; readonly contactId: string; readonly context: ContactBrowseContext }
  | { readonly kind: 'list'; readonly context: ContactBrowseContext };

/**
 * Chooses where work continues after a confirmed archive.
 *
 * The position is taken from the list as it was immediately before the archive
 * (the archived record is projected back as active), and the successor must
 * still be eligible in the list after the archive. That keeps A → B → C → D
 * moving from B to C, skips records archived concurrently, and never wraps back
 * to an earlier contact. The page number is recalculated from the successor's
 * position after removal so the context stays valid across page boundaries.
 */
export function resolveArchiveContinuation(
  contactsAfterArchive: readonly Contact[],
  archivedContactId: string,
  context: ContactBrowseContext,
  smartListDefinition?: SmartListDefinitionV1,
  pageSize = CONTACT_PAGE_SIZE,
): ArchiveContinuation {
  const beforeArchive = contactsAfterArchive.map((contact) => (contact.id === archivedContactId
    ? { ...contact, archivedAt: undefined, archivedByMembershipId: undefined, archiveReason: undefined }
    : contact));
  const before = contactBrowseSequence(beforeArchive, context, smartListDefinition);
  const after = contactBrowseSequence(contactsAfterArchive, context, smartListDefinition)
    .filter((contact) => contact.id !== archivedContactId);
  const afterIndex = new Map(after.map((contact, index) => [contact.id, index]));
  const pageFor = (index: number) => Math.floor(index / pageSize) + 1;
  const lastPage = Math.max(1, Math.ceil(after.length / pageSize));
  const listContext: ContactBrowseContext = {
    ...context,
    page: Math.min(context.page ?? 1, lastPage) > 1 ? Math.min(context.page ?? 1, lastPage) : undefined,
  };
  const position = before.findIndex((contact) => contact.id === archivedContactId);
  if (position < 0) return { kind: 'list', context: withoutEmptyPage(listContext) };
  for (const candidate of before.slice(position + 1)) {
    const index = afterIndex.get(candidate.id);
    if (index === undefined) continue;
    const page = pageFor(index);
    return {
      kind: 'next',
      contactId: candidate.id,
      context: withoutEmptyPage({ ...context, page: page > 1 ? page : undefined }),
    };
  }
  return { kind: 'list', context: withoutEmptyPage(listContext) };
}

function withoutEmptyPage(context: ContactBrowseContext): ContactBrowseContext {
  if (context.page !== undefined) return context;
  const { page: _page, ...rest } = context;
  void _page;
  return rest;
}

function hrefWithParams(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

export function contactRecordHref(
  contactId: string,
  context: ContactBrowseContext,
  saved?: string,
): string {
  const params = browseParams(context);
  if (saved) params.set('saved', saved);
  return hrefWithParams(`/contacts/${encodeURIComponent(contactId)}`, params);
}

export function contactEditHref(contactId: string, context: ContactBrowseContext): string {
  return hrefWithParams(`/contacts/${encodeURIComponent(contactId)}/edit`, browseParams(context));
}

export function contactListHref(context: ContactBrowseContext): string {
  if (context.archived) return hrefWithParams('/contacts', browseParams(context));
  return contactViewHref({
    scope: context.scope,
    query: context.query,
    leadType: context.leadType,
    source: context.source,
    smartList: context.smartList,
    page: context.page,
  });
}
