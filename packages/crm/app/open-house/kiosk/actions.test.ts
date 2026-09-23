import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { memoryRepository } from '@/lib/data/memory-repository';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { openHouseSignInAction } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, entry] of Object.entries(values)) data.set(key, entry);
  return data;
}

describe('openHouseSignInAction', () => {
  const repository = memoryRepository();

  beforeEach(() => {
    vi.mocked(getRepository).mockReset().mockResolvedValue({
      repository, activityRepository: createMemoryActivityRepository(), workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  it('signs the visitor in and returns a fresh submission key', async () => {
    const phone = `941${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const state = await openHouseSignInAction('1408 Bayshore Dr, Tampa, FL', { status: 'idle' }, form({ firstName: 'Ana', lastName: 'Cruz', phone }));
    expect(state).toMatchObject({ status: 'success', firstName: 'Ana' });
    expect(state.submissionKey).toBeTruthy();
    expect((await repository.list()).some((contact) => contact.phone === phone && contact.source === 'open-house')).toBe(true);
  });

  it('quietly drops honeypot submissions without touching the CRM', async () => {
    const state = await openHouseSignInAction('1408 Bayshore Dr', { status: 'idle' }, form({ firstName: 'Bot', lastName: 'Bot', website: 'spam.example' }));
    expect(state.status).toBe('success');
    expect(getRepository).not.toHaveBeenCalled();
  });

  it('keeps what the guest typed and highlights the fields to fix', async () => {
    const state = await openHouseSignInAction('1408 Bayshore Dr', { status: 'idle' }, form({ firstName: 'Ana', lastName: '', email: 'bad', website: '' }));
    expect(state.status).toBe('error');
    expect(state.fieldErrors).toMatchObject({ lastName: expect.any(String), email: expect.any(String) });
    expect(state.values).toMatchObject({ firstName: 'Ana', email: 'bad' });
    expect(state.values).not.toHaveProperty('website');
  });
});
