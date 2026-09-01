import {
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
  return params;
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
