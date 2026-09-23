import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { memoryRepository } from '@/lib/data/memory-repository';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { logCallOutcomeAction } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, entry] of Object.entries(values)) data.set(key, entry);
  return data;
}

describe('logCallOutcomeAction', () => {
  const repository = memoryRepository();
  beforeEach(() => {
    vi.mocked(getRepository).mockResolvedValue({
      repository, activityRepository: createMemoryActivityRepository(), workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  it('saves the outcome as a note, records the touch and schedules the follow-up', async () => {
    const contact = await repository.create({ firstName: 'Ana', lastName: `Call-${Math.random().toString(36).slice(2, 7)}`, leadType: 'hot', relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'new', tags: [] });
    const state = await logCallOutcomeAction(contact.id, { status: 'idle' }, form({ outcome: 'voicemail', followUp: 'tomorrow', note: 'Call back after 5' }));
    expect(state.status).toBe('saved');
    expect((await repository.notesFor(contact.id))[0]?.body).toBe('Call — left a voicemail. Call back after 5');
    const updated = await repository.get(contact.id);
    expect(updated?.lastContactedAt).toBeTruthy();
    expect(updated?.touchDateOverridden).toBe(true);
  });

  it('rejects unknown outcomes and follow-ups without saving', async () => {
    const contact = await repository.create({ firstName: 'Bo', lastName: 'Call', leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'new', tags: [] });
    expect(await logCallOutcomeAction(contact.id, { status: 'idle' }, form({ outcome: 'maybe', followUp: 'tomorrow' }))).toMatchObject({ status: 'error' });
    expect(await logCallOutcomeAction(contact.id, { status: 'idle' }, form({ outcome: 'talked', followUp: 'someday' }))).toMatchObject({ status: 'error' });
    expect(await repository.notesFor(contact.id)).toHaveLength(0);
  });
});
