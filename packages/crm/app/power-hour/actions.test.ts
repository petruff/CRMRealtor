import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { memoryRepository } from '@/lib/data/memory-repository';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { INITIAL_CONTACT_ACTION_STATE } from '@/lib/application/contact-action-state';
import { completePowerHourStepAction } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));

describe('Power Hour step', () => {
  const repository = memoryRepository();

  beforeEach(() => {
    vi.mocked(redirect).mockReset();
    vi.mocked(getRepository).mockResolvedValue({
      repository, activityRepository: createMemoryActivityRepository(), workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  async function lead() {
    return repository.create({
      firstName: 'Pia', lastName: `Power-${Math.random().toString(36).slice(2, 7)}`, leadType: 'hot', relationship: 'lead',
      intent: 'buyer', source: 'open-house', pipelineStage: 'new', tags: [],
    });
  }

  function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, entry] of Object.entries(values)) data.set(key, entry);
    return data;
  }

  it('saves the note, records the touch, sets the chosen follow-up and advances the session', async () => {
    const contact = await lead();
    await completePowerHourStepAction(contact.id, INITIAL_CONTACT_ACTION_STATE, form({
      note: 'Left voicemail\r\nCall after 5pm', followUp: 'tomorrow', sessionDone: '2', sessionSkip: 'c-x',
    }));

    const updated = await repository.get(contact.id);
    expect(updated?.lastContactedAt).toBeTruthy();
    expect(updated?.pipelineStage).toBe('contacted');
    expect(updated?.touchDateOverridden).toBe(true);
    expect(updated?.nextTouchAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await repository.notesFor(contact.id))[0]?.body).toBe('Left voicemail\nCall after 5pm');
    expect(redirect).toHaveBeenCalledWith('/power-hour?done=3&skip=c-x');
  });

  it('keeps the usual rhythm when no specific follow-up is chosen and allows an empty note', async () => {
    const contact = await lead();
    await completePowerHourStepAction(contact.id, INITIAL_CONTACT_ACTION_STATE, form({ followUp: 'cadence', sessionDone: '0' }));
    const updated = await repository.get(contact.id);
    expect(updated?.touchDateOverridden).toBe(false);
    expect(await repository.notesFor(contact.id)).toHaveLength(0);
    expect(redirect).toHaveBeenCalledWith('/power-hour?done=1');
  });

  it('rejects an unknown follow-up choice without changing anything and keeps the draft', async () => {
    const contact = await lead();
    const state = await completePowerHourStepAction(contact.id, INITIAL_CONTACT_ACTION_STATE, form({ note: 'Keep me', followUp: 'someday' }));
    expect(state).toMatchObject({ status: 'error', values: { note: 'Keep me' } });
    expect((await repository.get(contact.id))?.lastContactedAt).toBeUndefined();
    expect(await repository.notesFor(contact.id)).toHaveLength(0);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('refuses archived contacts', async () => {
    const contact = await lead();
    await repository.update(contact.id, { archivedAt: new Date().toISOString() });
    const state = await completePowerHourStepAction(contact.id, INITIAL_CONTACT_ACTION_STATE, form({ followUp: 'cadence' }));
    expect(state.message).toBe('Restore this contact before logging a conversation.');
  });
});
