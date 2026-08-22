/**
 * In-memory repository.
 *
 * Lets the app run and be demonstrated with no cloud project. State is cached on
 * `globalThis` so edits survive HMR module reloads in dev — otherwise every save
 * would silently reset her data mid-demo.
 *
 * Not a fallback for production: `getRepository()` only reaches for this when
 * Supabase is unconfigured, and says so in the console.
 */

import type { Contact, Note } from '../domain/contact.ts';
import type { ContactRepository } from './repository.ts';
import { seedContacts, seedNotes } from './seed.ts';

interface Store {
  contacts: Contact[];
  notes: Note[];
}

const CACHE_KEY = '__omnixMemoryStore__';

function store(): Store {
  const globalRef = globalThis as typeof globalThis & { [CACHE_KEY]?: Store };
  if (!globalRef[CACHE_KEY]) {
    const now = new Date();
    globalRef[CACHE_KEY] = { contacts: seedContacts(now), notes: seedNotes(now) };
  }
  return globalRef[CACHE_KEY];
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function memoryContactIsActive(id: string): boolean {
  const contact = store().contacts.find((item) => item.id === id);
  return Boolean(contact && !contact.archivedAt);
}

export function memoryRepository(): ContactRepository {
  return {
    async list(options) {
      return store().contacts.filter((contact) => (
        options?.archivedOnly ? Boolean(contact.archivedAt)
          : options?.includeArchived ? true : !contact.archivedAt
      ));
    },

    async get(id) {
      return store().contacts.find((c) => c.id === id);
    },

    async create(input) {
      const contact: Contact = {
        ...input,
        id: nextId('c'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store().contacts.push(contact);
      return contact;
    },

    async update(id, patch) {
      const state = store();
      const index = state.contacts.findIndex((c) => c.id === id);
      if (index === -1) throw new Error(`Contact ${id} not found`);

      const existing = state.contacts[index];
      if (!existing) throw new Error(`Contact ${id} not found`);

      const updated: Contact = {
        ...existing,
        ...patch,
        id: existing.id,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      };
      state.contacts[index] = updated;
      return updated;
    },

    async remove(id) {
      void id;
      throw new Error('Permanent contact deletion is unavailable. Use the archive lifecycle.');
    },

    async notesFor(contactId, options) {
      return store()
        .notes.filter((n) => n.contactId === contactId && (
          options?.archivedOnly ? Boolean(n.archivedAt) : options?.includeArchived ? true : !n.archivedAt
        ))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async addNote(contactId, body) {
      const note: Note = {
        id: nextId('n'),
        contactId,
        body,
        createdAt: new Date().toISOString(),
      };
      store().notes.push(note);
      return note;
    },
    async archiveNote(noteId, reason) {
      const note = store().notes.find((entry) => entry.id === noteId);
      if (!note) throw new Error('Note not found.');
      if (note.archivedAt) return { noOp: true };
      note.archivedAt = new Date().toISOString();
      note.archivedByMembershipId = 'sample-member';
      note.archiveReason = reason;
      return { noOp: false };
    },
    async restoreNote(noteId) {
      const note = store().notes.find((entry) => entry.id === noteId);
      if (!note) throw new Error('Note not found.');
      if (!note.archivedAt) return { noOp: true };
      delete note.archivedAt;
      delete note.archivedByMembershipId;
      delete note.archiveReason;
      return { noOp: false };
    },
    async runTransaction(operation) {
      const state = store();
      const contactsBefore = structuredClone(state.contacts);
      const notesBefore = structuredClone(state.notes);
      try {
        return await operation();
      } catch (error) {
        state.contacts = contactsBefore;
        state.notes = notesBefore;
        throw error;
      }
    },
  };
}
