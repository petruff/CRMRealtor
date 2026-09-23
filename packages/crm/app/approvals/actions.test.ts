import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { createOmnixProposalCommand, hashOmnixProposalPayload } from '@/lib/application/omnix-proposal-commands';
import { createMemoryOmnixProposalRepository } from '@/lib/data/memory-omnix-proposal-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { decideOmnixProposalAction, retryOmnixProposalAction } from './actions';

vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/application/omnix-provider-server-gateway', () => ({ createOmnixProviderServerGateway: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
describe('Server approval payload review', () => {
  it.each(['note-append', 'nurture-transition'] as const)('approves and recovers failed %s through the existing executor and scoped receipt', async (kind) => {
    const repository = createMemoryOmnixProposalRepository();
    const payload = kind === 'note-append' ? { contactId: 'contact-1', body: 'Exact approved note' }
      : { contactId: 'contact-1', planId: 'plan-1', expectedVersion: 1, action: 'pause' };
    const { proposalId } = await createOmnixProposalCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      kind, origin: 'gemini', approvalMode: 'active-member', contactId: 'contact-1',
      factors: { urgency: 40, leadTemperature: 'hot', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
      title: 'Exact action', rationale: 'Review this recommendation', payload,
      citations: [{ entityType: 'contact', recordId: 'contact-1', factKeys: ['nextTouchAt'], href: '/contacts/contact-1' }],
      expiresAt: '2099-01-01T00:00:00.000Z', idempotencyKey: 'action-fixture',
    });
    const appendNote = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ id: 'note-1' });
    const transition = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ id: 'plan-1', version: 2 });
    vi.mocked(getRepository).mockResolvedValue({ workspaceScope: SAMPLE_WORKSPACE_SCOPE, omnixProposalRepository: repository,
      captureOutcomeRepository: { appendNote }, nurturePlanRepository: { get: async () => ({ id: 'plan-1', contactId: 'contact-1' }), transition },
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const form = new FormData(); form.set('decision', 'approve'); form.set('proposalId', proposalId); form.set('version', '1');
    await decideOmnixProposalAction(form);
    expect((await repository.get(SAMPLE_WORKSPACE_SCOPE, proposalId))?.state).toBe('failed');
    const versionBefore = await repository.getVersion(SAMPLE_WORKSPACE_SCOPE, proposalId, 1);
    await retryOmnixProposalAction(form);
    expect(await repository.get(SAMPLE_WORKSPACE_SCOPE, proposalId)).toMatchObject({ state: 'executed',
      executionReference: kind === 'note-append' ? 'note:note-1' : 'nurture-plan:plan-1:version:2' });
    expect(await repository.getVersion(SAMPLE_WORKSPACE_SCOPE, proposalId, 1)).toEqual(versionBefore);
    if (kind === 'note-append') expect(appendNote).toHaveBeenLastCalledWith(SAMPLE_WORKSPACE_SCOPE, expect.objectContaining({ body: 'Exact approved note', proposalId, proposalVersion: 1 }));
    else expect(transition).toHaveBeenLastCalledWith(SAMPLE_WORKSPACE_SCOPE, 'plan-1', expect.objectContaining({ action: 'pause', expectedVersion: 1 }));
    log.mockRestore();
  });
  it.each(['targetResolutionRequired', 'audienceReviewRequired'])('rejects a forged approve submission with unresolved %s before any decision', async (flag) => {
    const payload = { subject: 'Draft', body: 'Proposed body', [flag]: true };
    const decide = vi.fn();
    vi.mocked(getRepository).mockResolvedValue({ workspaceScope: SAMPLE_WORKSPACE_SCOPE, omnixProposalRepository: {
      get: async () => ({ id: 'proposal-1', currentVersion: 1, expiresAt: '2099-01-01T00:00:00Z' }),
      getVersion: async () => ({ proposalId: 'proposal-1', version: 1, payload, contentHash: hashOmnixProposalPayload(payload) }), decide,
    } } as unknown as Awaited<ReturnType<typeof getRepository>>);
    const form = new FormData(); form.set('decision', 'approve'); form.set('proposalId', 'proposal-1'); form.set('version', '1');
    await expect(decideOmnixProposalAction(form)).rejects.toThrow('Review the exact');
    expect(decide).not.toHaveBeenCalled();
  });
});
