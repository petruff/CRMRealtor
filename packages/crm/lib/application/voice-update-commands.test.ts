import { describe, expect, it } from 'vitest';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { memoryRepository } from '@/lib/data/memory-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { applyVoiceUpdate, reviewVoiceUpdate, VoiceUpdateError } from './voice-update-commands';

async function seed() {
  const repository = memoryRepository();
  const activityRepository = createMemoryActivityRepository();
  const contact = await repository.create({
    firstName: 'Ana', lastName: `Voice-${Math.random().toString(36).slice(2, 7)}`, leadType: 'warm', relationship: 'lead',
    intent: 'buyer', source: 'website', pipelineStage: 'contacted', tags: [], buyer: { priceMax: 400_000 },
  });
  return { repository, activityRepository, contact, activity: { repository: activityRepository, scope: SAMPLE_WORKSPACE_SCOPE } };
}

const text = 'Just talked to Ana. Pre-approved for 450k, wants 3 beds in Doral. Call her Friday.';

describe('voice update commands', () => {
  it('reviews without changing anything', async () => {
    const { repository, contact } = await seed();
    const review = await reviewVoiceUpdate(repository, contact.id, text, '2026-09-24');
    expect(review.changes.map((change) => change.field)).toEqual(['priceMax', 'beds', 'areas', 'preApproved', 'nextTouchAt', 'talked']);
    expect((await repository.get(contact.id))?.buyer).toEqual({ priceMax: 400_000 });
  });

  it('applies only the kept changes, saves the note, logs the talk and sets the follow-up', async () => {
    const { repository, contact, activity, activityRepository } = await seed();
    const result = await applyVoiceUpdate({
      repository, activity, contactId: contact.id, text, keep: ['priceMax', 'beds', 'nextTouchAt', 'talked', 'invented'], saveNote: true,
      today: '2026-09-24', now: new Date('2026-09-24T15:00:00.000Z'),
    });
    expect(result.changed).toBe(5);
    const updated = await repository.get(contact.id);
    expect(updated?.buyer).toEqual({ priceMax: 450_000, beds: 3 });
    expect(updated?.lastContactedAt).toBe('2026-09-24T15:00:00.000Z');
    expect(updated).toMatchObject({ nextTouchAt: '2026-09-25', touchDateOverridden: true });
    expect((await repository.notesFor(contact.id)).map((note) => note.body)).toContain(text);
    const events = await activityRepository.listEvents(SAMPLE_WORKSPACE_SCOPE, { contactId: contact.id, limit: 20 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['note-added', 'contact-updated', 'touch-recorded']));
  });

  it('refuses empty text, unknown or archived contacts', async () => {
    const { repository, contact } = await seed();
    await expect(reviewVoiceUpdate(repository, contact.id, '  ', '2026-09-24')).rejects.toThrow(VoiceUpdateError);
    await expect(reviewVoiceUpdate(repository, 'missing', text, '2026-09-24')).rejects.toThrow(VoiceUpdateError);
    await expect(reviewVoiceUpdate(repository, '../x', text, '2026-09-24')).rejects.toThrow(VoiceUpdateError);
  });
});
