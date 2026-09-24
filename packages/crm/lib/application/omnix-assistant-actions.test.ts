import { describe, expect, it } from 'vitest';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { memoryRepository } from '@/lib/data/memory-repository';
import type { Contact } from '@/lib/domain/contact';
import { understandOmnixQuestion } from '@/lib/domain/omnix-understanding';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import {
  confirmOmnixAssistantAction,
  friendlyDueLabel,
  OmnixActionError,
  parseOmnixActionConfirmation,
  prepareOmnixAction,
} from './omnix-assistant-actions';

function contact(id: string, firstName: string, lastName: string, extra: Partial<Contact> = {}): Contact {
  return {
    id, firstName, lastName, leadType: 'hot', relationship: 'lead', intent: 'buyer', source: 'website', pipelineStage: 'new',
    tags: [], createdAt: '2026-09-01T12:00:00.000Z', ...extra,
  };
}

const contacts = [
  contact('c-alicia', 'Alicia', 'Monroe', { phone: '(305) 555-0101' }),
  contact('c-ana-1', 'Ana', 'Silva', { city: 'Miami' }),
  contact('c-ana-2', 'Ana', 'Costa', { city: 'Orlando' }),
  contact('c-old', 'Alicia', 'Archived', { archivedAt: '2026-09-02T00:00:00.000Z' }),
];

function prepare(question: string, selectedContactId?: string) {
  const understood = understandOmnixQuestion(question, selectedContactId);
  if (understood?.kind !== 'action') throw new Error(`not an action: ${question}`);
  return prepareOmnixAction({ action: understood.action, question, contacts, today: '2026-09-24', ...(selectedContactId ? { selectedContactId } : {}) });
}

describe('Omnix assistant actions', () => {
  it('prepares texts that open Messages, best fit first', () => {
    const preview = prepare('Write a follow-up message for Alicia after the showing');
    expect(preview.type).toBe('draft-text');
    if (preview.type !== 'draft-text') return;
    expect(preview.person).toMatchObject({ id: 'c-alicia', firstName: 'Alicia' });
    expect(preview.drafts[0]).toMatchObject({ kind: 'after-showing', recommended: true });
    expect(preview.drafts[0]?.href).toMatch(/^sms:3055550101\?&body=Hi%20Alicia/u);
    expect(preview.drafts).toHaveLength(5);
  });

  it('prepares a follow-up with a friendly date and topic', () => {
    const preview = prepare('Remind me to call Alicia tomorrow at 3pm about the inspection');
    expect(preview).toMatchObject({ type: 'create-task', title: 'Call Alicia Monroe about the inspection', dueDate: '2026-09-25', dueTime: '15:00', dueLabel: 'Tomorrow at 3 PM' });
    expect(prepare('Follow up with Alicia on Friday')).toMatchObject({ type: 'create-task', dueDate: '2026-09-25', dueTime: '09:00' });
    expect(prepare('Follow up with Alicia next week')).toMatchObject({ dueDate: '2026-09-28' });
  });

  it('asks which person when a first name is shared, and ignores archived contacts', () => {
    const preview = prepare('Draft a text to Ana');
    expect(preview.type).toBe('choose-contact');
    if (preview.type === 'choose-contact') expect(preview.candidates.map((item) => item.id)).toEqual(['c-ana-1', 'c-ana-2']);
    expect(prepare('Draft a text to Alicia')).toMatchObject({ type: 'draft-text', person: { id: 'c-alicia' } });
  });

  it('uses the contact in context for pronouns and asks when nobody is named', () => {
    expect(prepare('Add a note for her: loves the pool', 'c-ana-2')).toMatchObject({ type: 'log-note', person: { id: 'c-ana-2' }, body: 'loves the pool' });
    expect(prepare('Remind me to call tomorrow')).toEqual({ type: 'need-contact' });
  });

  it('validates what the realtor confirms', () => {
    expect(parseOmnixActionConfirmation({ type: 'create-task', contactId: 'c-1', title: ' Call  Ana ', dueDate: '2026-09-25', dueTime: '09:30' }))
      .toEqual({ type: 'create-task', contactId: 'c-1', title: 'Call Ana', dueDate: '2026-09-25', dueTime: '09:30' });
    expect(() => parseOmnixActionConfirmation({ type: 'create-task', contactId: 'c-1', title: 'x', dueDate: '2026-13-40', dueTime: '09:30' })).toThrow(OmnixActionError);
    expect(() => parseOmnixActionConfirmation({ type: 'log-note', contactId: '../x', body: 'hi' })).toThrow(OmnixActionError);
    expect(() => parseOmnixActionConfirmation({ type: 'delete-contact', contactId: 'c-1' })).toThrow(OmnixActionError);
    expect(() => parseOmnixActionConfirmation(null)).toThrow(OmnixActionError);
  });

  it('saves a confirmed follow-up at the local time and a confirmed note', async () => {
    const repository = memoryRepository();
    const activityRepository = createMemoryActivityRepository();
    const saved = await repository.create({ firstName: 'Nia', lastName: `Omnix-${Math.random().toString(36).slice(2, 7)}`, leadType: 'warm', relationship: 'lead', intent: 'seller', source: 'referral', pipelineStage: 'new', tags: [] });
    const context = { repository, activityRepository, workspaceScope: SAMPLE_WORKSPACE_SCOPE, timeZone: 'America/New_York' };

    const task = await confirmOmnixAssistantAction(context, { type: 'create-task', contactId: saved.id, title: 'Call Nia', dueDate: '2026-09-25', dueTime: '09:00' });
    expect(task.message).toContain('Follow-up saved');
    const tasks = await activityRepository.listTasks(SAMPLE_WORKSPACE_SCOPE, { contactId: saved.id, status: 'all', limit: 10 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Call Nia', dueAt: '2026-09-25T13:00:00.000Z' });

    const note = await confirmOmnixAssistantAction(context, { type: 'log-note', contactId: saved.id, body: 'Wants to list in spring.' });
    expect(note.href).toContain('#notes');
    expect((await repository.notesFor(saved.id)).map((item) => item.body)).toContain('Wants to list in spring.');

    await expect(confirmOmnixAssistantAction(context, { type: 'log-note', contactId: 'missing', body: 'x' })).rejects.toThrow(OmnixActionError);
  });

  it('labels due dates in plain words', () => {
    expect(friendlyDueLabel('2026-09-24', '09:00', '2026-09-24')).toBe('Today at 9 AM');
    expect(friendlyDueLabel('2026-09-28', '14:30', '2026-09-24')).toBe('Monday, Sep 28 at 2:30 PM');
  });

  it('turns an update with home details into a reviewable contact update', async () => {
    const preview = prepare('Update Alicia: pre-approved for 450k, wants 3 beds in Doral. Call her Friday.');
    expect(preview.type).toBe('voice-update');
    if (preview.type !== 'voice-update') return;
    expect(preview.person.id).toBe('c-alicia');
    expect(preview.changes.map((change) => change.field)).toEqual(['priceMax', 'beds', 'areas', 'preApproved', 'nextTouchAt']);

    const repository = memoryRepository();
    const saved = await repository.create({ firstName: 'Alicia', lastName: `Upd-${Math.random().toString(36).slice(2, 7)}`, leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'website', pipelineStage: 'contacted', tags: [] });
    const confirmation = parseOmnixActionConfirmation({ type: 'voice-update', contactId: saved.id, text: preview.note, keep: ['priceMax', 'beds'], saveNote: false });
    await confirmOmnixAssistantAction({ repository, workspaceScope: SAMPLE_WORKSPACE_SCOPE, timeZone: 'America/New_York' }, confirmation);
    expect((await repository.get(saved.id))?.buyer).toEqual({ priceMax: 450_000, beds: 3 });
    expect(await repository.notesFor(saved.id)).toHaveLength(0);
  });
});
