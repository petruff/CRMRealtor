/**
 * Data access boundary.
 *
 * The UI talks only to this interface, never to a database client. That is what
 * lets the app run and look finished before any cloud project exists — and it
 * means swapping the in-memory implementation for Supabase touches this one
 * module rather than every screen.
 */

import type { Contact, Note } from '../domain/contact.ts';

export interface ContactRepository {
  list(options?: { readonly includeArchived?: boolean; readonly archivedOnly?: boolean }): Promise<Contact[]>;
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
