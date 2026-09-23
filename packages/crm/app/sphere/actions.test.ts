import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { memoryRepository } from '@/lib/data/memory-repository';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { markSphereMessageSentAction } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));

describe('markSphereMessageSentAction', () => {
  const repository = memoryRepository();
  beforeEach(() => {
    vi.mocked(getRepository).mockResolvedValue({
      repository, activityRepository: createMemoryActivityRepository(), workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, entry] of Object.entries(values)) data.set(key, entry);
    return data;
  }

  it('logs the message as a conversation and records the touch', async () => {
    const contact = await repository.create({ firstName: 'Gina', lastName: `Sphere-${Math.random().toString(36).slice(2, 7)}`, leadType: 'nurture', relationship: 'past-client', intent: 'buyer', source: 'referral', pipelineStage: 'closed', tags: [] });
    const state = await markSphereMessageSentAction(contact.id, { status: 'idle' }, form({ kind: 'homeaversary', channel: 'text', language: 'es' }));
    expect(state.status).toBe('sent');
    const notes = await repository.notesFor(contact.id);
    expect(notes[0]?.body).toBe('Sent home anniversary message by text (Spanish).');
    expect((await repository.get(contact.id))?.lastContactedAt).toBeTruthy();
  });

  it('rejects unknown message kinds', async () => {
    expect(await markSphereMessageSentAction('c-x', { status: 'idle' }, form({ kind: 'spam', channel: 'text' }))).toMatchObject({ status: 'error' });
  });
});
