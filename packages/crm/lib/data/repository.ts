/**
 * Data access boundary.
 *
 * The UI talks only to this interface, never to a database client. That is what
 * lets the app run and look finished before any cloud project exists — and it
 * means swapping the in-memory implementation for Supabase touches this one
 * module rather than every screen.
 */

import type {
  Contact,
  LeadType,
  Note,
  QualificationStatus,
  Relationship,
} from '../domain/contact.ts';
import type { SmartListDefinitionV1 } from '../domain/smart-list.ts';

export const CONTACT_PAGE_SCOPES = [
  'leads',
  'clients',
  'active-clients',
  'past-clients',
  'needs-review',
  'all',
] as const;
export type ContactPageScope = (typeof CONTACT_PAGE_SCOPES)[number];

export interface ContactListOptions {
  readonly includeArchived?: boolean;
  readonly archivedOnly?: boolean;
  readonly relationships?: readonly Relationship[];
  readonly qualificationStatus?: QualificationStatus;
  readonly leadType?: LeadType;
}

export interface ContactPageRequest extends ContactListOptions {
  readonly offset: number;
  readonly limit: number;
  readonly scope?: ContactPageScope;
  readonly query?: string;
  readonly source?: Contact['source'];
  readonly smartListId?: string;
  /** Used only by deterministic adapters; the live adapter resolves the ID transactionally. */
  readonly smartListDefinition?: SmartListDefinitionV1;
}

export interface ContactPage {
  readonly items: readonly Contact[];
  /** Exact canonical-contact count after all requested filters. */
  readonly total: number;
  readonly activeTotal: number;
  readonly scopeCounts: Readonly<Record<ContactPageScope, number>>;
  readonly leadTypeCounts: Readonly<Record<LeadType, number>>;
  readonly offset: number;
  readonly limit: number;
  readonly aliasEpoch: number;
}

export interface ContactRepository {
  /** Exhaustive read. Implementations must paginate upstream rather than silently truncate. */
  list(options?: ContactListOptions): Promise<Contact[]>;
  /** Bounded upstream read window with an exact total; never implemented as list-then-slice. */
  listPage?(request: ContactPageRequest): Promise<ContactPage>;
  get(id: string): Promise<Contact | undefined>;
  create(contact: Omit<Contact, 'id' | 'createdAt'>): Promise<Contact>;
  update(id: string, patch: Partial<Contact>): Promise<Contact>;
  /** Permanent deletion is intentionally unavailable; use rich-contact archive/restore. */
  remove(id: string): Promise<void>;

  notesFor(contactId: string, options?: { readonly includeArchived?: boolean; readonly archivedOnly?: boolean }): Promise<Note[]>;
  addNote(contactId: string, body: string): Promise<Note>;
  archiveNote?(noteId: string, reason: string, correlationId: string, occurredAt?: string): Promise<{ readonly noOp: boolean }>;
  restoreNote?(noteId: string, correlationId: string, occurredAt?: string): Promise<{ readonly noOp: boolean }>;
  /** Memory-only rollback boundary; live imports use the database RPC instead. */
  runTransaction?<T>(operation: () => Promise<T>): Promise<T>;
}
