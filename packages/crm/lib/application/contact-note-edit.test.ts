import { describe, expect, it } from 'vitest';
import { memoryNoteRevisions, memoryRepository } from '@/lib/data/memory-repository';
import { NoteEditError, type Note } from '@/lib/domain/contact';
import type { ContactRepository } from '@/lib/data/repository';
import {
  ContactCommandError,
  NOTE_EDIT_CONFLICT_MESSAGE,
  editContactNoteCommand,
} from '@/lib/application/contact-commands';

const NOW = new Date('2026-09-23T15:00:00.000Z');

function form(body: string, revision: number | string) {
  const data = new FormData();
  data.set('body', body);
  data.set('revision', String(revision));
  return data;
}

async function seed(repository: ContactRepository, body = 'Wants 3 beds') {
  const contact = await repository.create({
    firstName: 'Nora', lastName: `Notes-${Math.random().toString(36).slice(2, 7)}`, leadType: 'warm',
    relationship: 'lead', intent: 'buyer', source: 'other', pipelineStage: 'new', tags: [],
  });
  const note = await repository.addNote(contact.id, body);
  return { contact, note };
}

async function reopen(repository: ContactRepository, contactId: string, noteId: string): Promise<Note | undefined> {
  return (await repository.notesFor(contactId, { includeArchived: true })).find((entry) => entry.id === noteId);
}

describe('editContactNoteCommand', () => {
  it('saves in place: same id, contact and createdAt, new body persisted and marked edited', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);

    const result = await editContactNoteCommand(repository, contact.id, note.id, form('Wants 4 beds\nNear the park', 1), 'corr-1', NOW);
    const reopened = await reopen(repository, contact.id, note.id);
    const all = await repository.notesFor(contact.id);

    expect(result.noOp).toBe(false);
    expect(reopened).toMatchObject({
      id: note.id, contactId: contact.id, createdAt: note.createdAt,
      body: 'Wants 4 beds\nNear the park', revision: 2, updatedAt: NOW.toISOString(),
    });
    expect(all).toHaveLength(1);
    expect(memoryNoteRevisions(note.id)).toEqual([expect.objectContaining({ revision: 1, body: 'Wants 3 beds', correlationId: 'corr-1' })]);
  });

  it('treats notes created before editing existed as revision 1', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository, 'Legacy note');
    expect(note.revision).toBeUndefined();

    await editContactNoteCommand(repository, contact.id, note.id, form('Legacy note, corrected', 1), 'corr-legacy', NOW);

    expect(await reopen(repository, contact.id, note.id)).toMatchObject({ body: 'Legacy note, corrected', revision: 2 });
  });

  it('rejects blank and whitespace-only content with a field error and changes nothing', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);

    await expect(editContactNoteCommand(repository, contact.id, note.id, form(' \n\t ', 1), 'corr-blank', NOW))
      .rejects.toMatchObject({ fieldErrors: { body: 'A note cannot be blank.' } });
    expect((await reopen(repository, contact.id, note.id))?.body).toBe('Wants 3 beds');
    expect(memoryNoteRevisions(note.id)).toHaveLength(0);
  });

  it('detects a concurrent edit instead of silently overwriting it', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);
    await editContactNoteCommand(repository, contact.id, note.id, form('Other tab wins', 1), 'corr-tab-a', NOW);

    await expect(editContactNoteCommand(repository, contact.id, note.id, form('Stale tab', 1), 'corr-tab-b', NOW))
      .rejects.toThrow(NOTE_EDIT_CONFLICT_MESSAGE);
    expect((await reopen(repository, contact.id, note.id))?.body).toBe('Other tab wins');
  });

  it('maps a conflict raised by the database layer to the same guidance', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);
    const racing: ContactRepository = {
      ...repository,
      editNote: async () => { throw new NoteEditError('conflict', 'note revision conflict'); },
    };

    await expect(editContactNoteCommand(racing, contact.id, note.id, form('Late save', 1), 'corr-race', NOW))
      .rejects.toThrow(NOTE_EDIT_CONFLICT_MESSAGE);
  });

  it('is idempotent for a replayed submission', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);
    await editContactNoteCommand(repository, contact.id, note.id, form('Once', 1), 'corr-replay', NOW);

    const replay = await repository.editNote!({ noteId: note.id, body: 'Once', expectedRevision: 1, correlationId: 'corr-replay' });

    expect(replay.noOp).toBe(true);
    expect(memoryNoteRevisions(note.id)).toHaveLength(1);
  });

  it('keeps archived notes and archived contacts read only', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);
    await repository.archiveNote!(note.id, 'Outdated context', 'corr-archive');

    await expect(editContactNoteCommand(repository, contact.id, note.id, form('Edit archived', 1), 'corr-a', NOW))
      .rejects.toThrow('Restore this note before editing it.');

    const second = await seed(repository);
    await repository.update(second.contact.id, { archivedAt: NOW.toISOString() });
    await expect(editContactNoteCommand(repository, second.contact.id, second.note.id, form('Edit', 1), 'corr-b', NOW))
      .rejects.toThrow('Restore this contact before editing its notes.');
  });

  it('refuses a note that does not belong to the contact in the URL', async () => {
    const repository = memoryRepository();
    const mine = await seed(repository);
    const theirs = await seed(repository);

    await expect(editContactNoteCommand(repository, mine.contact.id, theirs.note.id, form('Hijack', 1), 'corr-x', NOW))
      .rejects.toBeInstanceOf(ContactCommandError);
    expect((await reopen(repository, theirs.contact.id, theirs.note.id))?.body).toBe('Wants 3 beds');
  });
});

describe('editContactNoteCommand line breaks', () => {
  it('stores browser CRLF line breaks as plain newlines', async () => {
    const repository = memoryRepository();
    const { contact, note } = await seed(repository);
    await editContactNoteCommand(repository, contact.id, note.id, form('First line\r\nSecond line', 1), 'corr-crlf', NOW);
    expect((await reopen(repository, contact.id, note.id))?.body).toBe('First line\nSecond line');
  });
});
