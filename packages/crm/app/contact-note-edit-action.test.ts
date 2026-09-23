import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { memoryRepository } from '@/lib/data/memory-repository';
import { INITIAL_CONTACT_ACTION_STATE } from '@/lib/application/contact-action-state';
import { editContactNoteAction } from './contact-actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));

describe('editContactNoteAction', () => {
  const repository = memoryRepository();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRepository).mockResolvedValue({ repository } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  async function seed() {
    const contact = await repository.create({
      firstName: 'Ada', lastName: `Action-${Math.random().toString(36).slice(2, 7)}`, leadType: 'hot',
      relationship: 'lead', intent: 'buyer', source: 'other', pipelineStage: 'new', tags: [],
    });
    return { contact, note: await repository.addNote(contact.id, 'Original') };
  }

  function form(body: string, revision = '1') {
    const data = new FormData();
    data.set('body', body);
    data.set('revision', revision);
    return data;
  }

  it('persists the edit, refreshes the contact without a redirect, and survives a reload', async () => {
    const { contact, note } = await seed();

    const state = await editContactNoteAction(contact.id, note.id, INITIAL_CONTACT_ACTION_STATE, form('Line one\nLine two'));

    expect(state).toEqual({ status: 'success', message: 'Note updated.' });
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/contacts/${contact.id}`);
    const [reloaded] = await repository.notesFor(contact.id);
    expect(reloaded).toMatchObject({ id: note.id, body: 'Line one\nLine two', createdAt: note.createdAt, revision: 2 });
  });

  it('returns the draft on failure so the editor keeps what was typed', async () => {
    const { contact, note } = await seed();
    await editContactNoteAction(contact.id, note.id, INITIAL_CONTACT_ACTION_STATE, form('First save'));

    const state = await editContactNoteAction(contact.id, note.id, INITIAL_CONTACT_ACTION_STATE, form('Stale draft', '1'));

    expect(state.status).toBe('error');
    expect(state.message).toMatch(/changed in another session/);
    expect(state.values).toMatchObject({ body: 'Stale draft', revision: '1' });
    expect((await repository.notesFor(contact.id))[0]?.body).toBe('First save');
  });

  it('reports a no-op when nothing changed', async () => {
    const { contact, note } = await seed();
    const state = await editContactNoteAction(contact.id, note.id, INITIAL_CONTACT_ACTION_STATE, form('Original'));
    expect(state).toEqual({ status: 'success', message: 'No changes to save.' });
  });
});
