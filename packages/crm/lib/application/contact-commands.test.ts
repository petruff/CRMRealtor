import { describe, expect, it } from 'vitest';
import type { Contact, Note } from '@/lib/domain/contact';
import type { ContactRepository } from '@/lib/data/repository';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import {
  addContactNoteCommand,
  archiveContactNoteCommand,
  createContactCommand,
  recordContactTouchCommand,
  updateContactCommand,
  restoreContactNoteCommand,
} from '@/lib/application/contact-commands';

const NOW = new Date('2026-08-10T15:00:00.000Z');

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c-1',
    firstName: 'Avery',
    lastName: 'Stone',
    phone: '555-0100',
    leadType: 'hot',
    relationship: 'lead',
    intent: 'buyer',
    source: 'open-house',
    pipelineStage: 'new',
    nextTouchAt: '2026-08-11',
    touchDateOverridden: false,
    tags: [],
    emailSubscribed: true,
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

class FakeRepository implements ContactRepository {
  contacts: Contact[];
  notes: Note[] = [];
  failCreate = false;

  constructor(initial: Contact[] = []) {
    this.contacts = [...initial];
  }

  async list() {
    return [...this.contacts];
  }

  async get(id: string) {
    return this.contacts.find((entry) => entry.id === id);
  }

  async create(input: Omit<Contact, 'id' | 'createdAt'>) {
    if (this.failCreate) throw new Error('database offline');
    const created: Contact = {
      ...input,
      id: `c-${this.contacts.length + 1}`,
      createdAt: NOW.toISOString(),
    };
    this.contacts.push(created);
    return created;
  }

  async update(id: string, patch: Partial<Contact>) {
    const index = this.contacts.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('not found');
    const existing = this.contacts[index];
    if (!existing) throw new Error('not found');
    const updated = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    this.contacts[index] = updated;
    return updated;
  }

  async remove(id: string) {
    this.contacts = this.contacts.filter((entry) => entry.id !== id);
  }

  async notesFor(contactId: string) {
    return this.notes.filter((note) => note.contactId === contactId);
  }

  async addNote(contactId: string, body: string) {
    const note: Note = {
      id: `n-${this.notes.length + 1}`,
      contactId,
      body,
      createdAt: NOW.toISOString(),
    };
    this.notes.unshift(note);
    return note;
  }

  async archiveNote(noteId: string, reason: string) {
    const note = this.notes.find((entry) => entry.id === noteId);
    if (!note) throw new Error('not found');
    if (note.archivedAt) return { noOp: true };
    note.archivedAt = NOW.toISOString(); note.archiveReason = reason;
    return { noOp: false };
  }

  async restoreNote(noteId: string) {
    const note = this.notes.find((entry) => entry.id === noteId);
    if (!note) throw new Error('not found');
    if (!note.archivedAt) return { noOp: true };
    delete note.archivedAt; delete note.archiveReason;
    return { noOp: false };
  }
}

function form(overrides: Record<string, string | undefined> = {}): FormData {
  const values: Record<string, string | undefined> = {
    firstName: '  Jamie ',
    lastName: ' Rivera ',
    phone: '555-0199',
    email: 'jamie@example.com',
    leadType: 'hot',
    relationship: 'lead',
    intent: 'buyer',
    source: 'open-house',
    pipelineStage: 'new',
    emailSubscribed: 'on',
    ...overrides,
  };
  const data = new FormData();
  for (const [key, entry] of Object.entries(values)) {
    if (entry !== undefined) data.set(key, entry);
  }
  return data;
}

describe('contact commands', () => {
  it('creates a normalized contact and schedules the existing cadence', async () => {
    const repository = new FakeRepository();
    const created = await createContactCommand(repository, form({ tags: 'Buyer, VIP, Buyer' }), NOW);

    expect(created.firstName).toBe('Jamie');
    expect(created.lastName).toBe('Rivera');
    expect(created.tags).toEqual(['Buyer', 'VIP']);
    expect(created.nextTouchAt).toBe('2026-08-17');
    expect(created.touchDateOverridden).toBe(false);
    expect(created.qualificationStatus).toBe('qualified');
  });

  it('keeps Figure out separate from lead temperature and archives notes reversibly', async () => {
    const repository = new FakeRepository([contact()]);
    const updated = await updateContactCommand(repository, 'c-1', form({ qualificationStatus: 'needs-qualification' }), NOW);
    expect(updated.qualificationStatus).toBe('needs-qualification');
    expect(updated.leadType).toBe('hot');
    const noteForm = new FormData(); noteForm.set('body', 'Original text');
    const note = await addContactNoteCommand(repository, 'c-1', noteForm, NOW);
    const archiveForm = new FormData(); archiveForm.set('reason', 'Outdated context');
    await archiveContactNoteCommand(repository, 'c-1', note.id, archiveForm, 'correlation-a', NOW);
    expect(note.body).toBe('Original text');
    expect(note.archivedAt).toBeTruthy();
    await restoreContactNoteCommand(repository, 'c-1', note.id, 'correlation-b', NOW);
    expect(note.archivedAt).toBeUndefined();
  });

  it('requires at least one name', async () => {
    const repository = new FakeRepository();
    await expect(
      createContactCommand(repository, form({ firstName: ' ', lastName: ' ' }), NOW),
    ).rejects.toMatchObject({
      message: 'Enter at least a first or last name.',
      fieldErrors: { firstName: 'Enter a first or last name.' },
    });
  });

  it('rejects invalid enum and date input on the server', async () => {
    const repository = new FakeRepository();
    await expect(
      createContactCommand(repository, form({ leadType: 'urgent' }), NOW),
    ).rejects.toMatchObject({ fieldErrors: { leadType: 'Choose a valid option.' } });
    await expect(
      createContactCommand(repository, form({ birthdate: '2026-02-30' }), NOW),
    ).rejects.toMatchObject({ fieldErrors: { birthdate: 'Enter a valid date.' } });
  });

  it('rejects an invalid email address', async () => {
    const repository = new FakeRepository();
    await expect(
      createContactCommand(repository, form({ email: 'not-an-email' }), NOW),
    ).rejects.toMatchObject({ fieldErrors: { email: 'Enter a valid email address.' } });
  });

  it('honours a manual next-touch date on create', async () => {
    const repository = new FakeRepository();
    const created = await createContactCommand(
      repository,
      form({ nextTouchAt: '2026-09-01' }),
      NOW,
    );
    expect(created.nextTouchAt).toBe('2026-09-01');
    expect(created.touchDateOverridden).toBe(true);
  });

  it('updates editable fields without changing identity or creation time', async () => {
    const original = contact();
    const repository = new FakeRepository([original]);
    const updated = await updateContactCommand(
      repository,
      original.id,
      form({ firstName: 'Morgan', lastName: 'Lee', phone: '', nextTouchAt: '2026-08-20' }),
      NOW,
    );

    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.firstName).toBe('Morgan');
    expect(updated.phone).toBeUndefined();
    expect(updated.nextTouchAt).toBe('2026-08-20');
    expect(updated.touchDateOverridden).toBe(true);
  });

  it('restores automatic cadence when an active edit clears the next date', async () => {
    const repository = new FakeRepository([
      contact({ nextTouchAt: '2026-09-20', touchDateOverridden: true }),
    ]);
    const updated = await updateContactCommand(
      repository,
      'c-1',
      form({ nextTouchAt: '' }),
      NOW,
    );
    expect(updated.nextTouchAt).toBe('2026-08-10');
    expect(updated.touchDateOverridden).toBe(false);
  });

  it('clears cadence when a contact becomes dormant', async () => {
    const repository = new FakeRepository([contact()]);
    const updated = await updateContactCommand(
      repository,
      'c-1',
      form({ pipelineStage: 'closed', nextTouchAt: '2026-09-01' }),
      NOW,
    );
    expect(updated.nextTouchAt).toBeUndefined();
    expect(updated.touchDateOverridden).toBe(false);
  });

  it('does not allow a contact to refer themselves', async () => {
    const repository = new FakeRepository([contact()]);
    await expect(
      updateContactCommand(repository, 'c-1', form({ referredById: 'c-1' }), NOW),
    ).rejects.toMatchObject({ fieldErrors: { referredById: 'Choose another contact.' } });
  });

  it('appends a trimmed non-blank note', async () => {
    const repository = new FakeRepository([contact()]);
    const data = new FormData();
    data.set('body', '  Asked for a lender introduction.  ');
    const note = await addContactNoteCommand(repository, 'c-1', data);
    expect(note.body).toBe('Asked for a lender introduction.');

    data.set('body', '   ');
    await expect(addContactNoteCommand(repository, 'c-1', data)).rejects.toMatchObject({
      fieldErrors: { body: 'A note cannot be blank.' },
    });
  });

  it('refuses to attach a note to a missing contact', async () => {
    const data = new FormData();
    data.set('body', 'This should not be orphaned.');
    await expect(addContactNoteCommand(new FakeRepository(), 'missing', data)).rejects.toThrow(
      'Contact not found.',
    );
  });

  it('records a touch through the cadence engine', async () => {
    const repository = new FakeRepository([
      contact({ nextTouchAt: '2026-09-01', touchDateOverridden: true }),
    ]);
    const updated = await recordContactTouchCommand(repository, 'c-1', NOW);
    expect(updated.lastContactedAt).toBe(NOW.toISOString());
    expect(updated.nextTouchAt).toBe('2026-08-17');
    expect(updated.touchDateOverridden).toBe(false);
    expect(updated.pipelineStage).toBe('contacted');
  });

  it('appends the corresponding CRM activities and deduplicates an exact touch replay', async () => {
    const repository = new FakeRepository();
    const activityRepository = createMemoryActivityRepository();
    const activity = { repository: activityRepository, scope: SAMPLE_WORKSPACE_SCOPE };
    const created = await createContactCommand(repository, form(), NOW, activity);
    await updateContactCommand(repository, created.id, form({ city: 'Miami' }), NOW, activity);

    const noteData = new FormData();
    noteData.set('body', 'Requested a market analysis.');
    await addContactNoteCommand(repository, created.id, noteData, NOW, activity);
    await recordContactTouchCommand(repository, created.id, NOW, activity);
    await recordContactTouchCommand(repository, created.id, NOW, activity);

    const events = await activityRepository.listEvents(SAMPLE_WORKSPACE_SCOPE, { limit: 100 });
    expect(events.map((event) => event.type).sort()).toEqual([
      'contact-created',
      'contact-updated',
      'note-added',
      'touch-recorded',
    ]);
    expect(events.every((event) => event.contactId === created.id)).toBe(true);
  });

  it('propagates repository failures instead of claiming success', async () => {
    const repository = new FakeRepository();
    repository.failCreate = true;
    await expect(createContactCommand(repository, form(), NOW)).rejects.toThrow('database offline');
  });
});
