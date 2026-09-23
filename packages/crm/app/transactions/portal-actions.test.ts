import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { memoryClientPortalRepository } from '@/lib/data/client-portal-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import type { RealEstateTransaction } from '@/lib/domain/transaction';
import { createPortalLinkAction } from './portal-actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ host: 'crm.example.com', 'x-forwarded-proto': 'https' })) }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));

const deal = { id: '00000000-0000-4000-8000-000000000003', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, status: 'pending', side: 'buyer', propertyAddress: '1408 Bayshore Dr' } as unknown as RealEstateTransaction;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, entry] of Object.entries(values)) data.set(key, entry);
  return data;
}

describe('createPortalLinkAction', () => {
  beforeEach(() => {
    const transactions = async () => [deal];
    vi.mocked(getRepository).mockResolvedValue({
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      transactionRepository: { list: transactions },
      clientPortalRepository: memoryClientPortalRepository({ scope: SAMPLE_WORKSPACE_SCOPE, transactions, milestones: async () => [] }),
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  it('returns a full https link on the current host', async () => {
    const state = await createPortalLinkAction(deal.id, { status: 'idle' }, form({ audience: 'Linh', days: '60' }));
    expect(state.status).toBe('created');
    expect(state.url).toMatch(/^https:\/\/crm\.example\.com\/portal\/[A-Za-z0-9_-]{43}$/);
  });

  it('explains validation problems in plain language', async () => {
    expect(await createPortalLinkAction(deal.id, { status: 'idle' }, form({ audience: '', days: '60' }))).toMatchObject({ status: 'error', message: expect.stringContaining('who this link is for') });
    expect(await createPortalLinkAction(deal.id, { status: 'idle' }, form({ audience: 'Linh', days: '999' }))).toMatchObject({ status: 'error', message: expect.stringContaining('how long') });
    expect(await createPortalLinkAction('00000000-0000-4000-8000-000000000009', { status: 'idle' }, form({ audience: 'Linh', days: '30' }))).toMatchObject({ status: 'error', message: 'This deal is no longer available.' });
  });
});
