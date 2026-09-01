import { displayName, type Contact } from '@/lib/domain/contact';

export type ContactRecordScope = 'leads' | 'active-clients' | 'past-clients' | 'archived';

export interface ContactRecordNavigation {
  readonly scope: ContactRecordScope;
  readonly position: number;
  readonly total: number;
  readonly previous?: Contact;
  readonly next?: Contact;
}

function recordScope(contact: Contact): ContactRecordScope {
  if (contact.archivedAt) return 'archived';
  if (contact.relationship === 'past-client') return 'past-clients';
  if (contact.relationship === 'active-client') return 'active-clients';
  return 'leads';
}

function stableContactOrder(left: Contact, right: Contact): number {
  const byName = displayName(left).localeCompare(displayName(right), 'en-US', {
    numeric: true,
    sensitivity: 'base',
  });
  return byName || left.id.localeCompare(right.id);
}

export function contactRecordNavigation(
  contacts: readonly Contact[],
  current: Contact,
): ContactRecordNavigation {
  const scope = recordScope(current);
  const ordered = contacts
    .filter((contact) => recordScope(contact) === scope)
    .sort(stableContactOrder);
  const index = ordered.findIndex((contact) => contact.id === current.id);
  if (index < 0) return { scope, position: 1, total: 1 };
  return {
    scope,
    position: index + 1,
    total: ordered.length,
    ...(index > 0 ? { previous: ordered[index - 1] } : {}),
    ...(index + 1 < ordered.length ? { next: ordered[index + 1] } : {}),
  };
}

export function contactRecordHref(contactId: string, scope: ContactRecordScope): string {
  const suffix = scope === 'archived' ? '?view=archived' : '';
  return `/contacts/${encodeURIComponent(contactId)}${suffix}`;
}

export function contactListHref(scope: ContactRecordScope): string {
  return scope === 'archived' ? '/contacts?view=archived' : `/contacts?scope=${scope}`;
}
