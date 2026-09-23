import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getRepository } from '@/lib/data';
import { createMemoryOmnixProposalRepository } from '@/lib/data/memory-omnix-proposal-repository';
import { createOmnixProposalCommand } from '@/lib/application/omnix-proposal-commands';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import Page from './page';

vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('./actions', () => ({ acknowledgeInboundResponseAction: vi.fn(), decideOmnixProposalAction: vi.fn(), retryOmnixProposalAction: vi.fn() }));

async function fixture(payload: Record<string, unknown> = { contactId: 'contact-1', title: 'Call Alicia', description: 'Discuss the inspection', dueAt: '2026-09-10T14:00:00.000Z' }) {
  const repository = createMemoryOmnixProposalRepository();
  const receipt = await createOmnixProposalCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
    kind: 'task-create', origin: 'gemini', approvalMode: 'active-member', contactId: 'contact-1',
    factors: { urgency: 40, leadTemperature: 'hot', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
    title: 'Exact action', rationale: 'Review this recommendation', payload,
    citations: [{ entityType: 'contact', recordId: 'contact-1', factKeys: ['nextTouchAt'], href: '/contacts/contact-1' }],
    expiresAt: '2099-01-01T00:00:00.000Z', idempotencyKey: 'review-fixture',
  });
  // The selected item is deliberately absent from the first fifty queue results.
  const list = vi.spyOn(repository, 'list').mockResolvedValue([]);
  const get = vi.spyOn(repository, 'get');
  vi.mocked(getRepository).mockResolvedValue({ workspaceScope: SAMPLE_WORKSPACE_SCOPE, isLive: false,
    omnixProposalRepository: repository, operationalSignalRepository: { listInbound: async () => [] },
  } as unknown as Awaited<ReturnType<typeof getRepository>>);
  return { repository, receipt, list, get };
}

beforeEach(() => vi.clearAllMocks());
describe('Exact approval review', () => {
  it('loads the scoped exact proposal outside the queue and displays the full saved payload before approval', async () => {
    const { receipt, get, list } = await fixture();
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ proposalId: receipt.proposalId }) }));
    expect(list).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, expect.objectContaining({ limit: 50 }));
    expect(get).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, receipt.proposalId);
    expect(html).toContain(`id="proposal-${receipt.proposalId}"`);
    expect(html).toContain('Discuss the inspection');
    expect(html).toContain('2026-09-10T14:00:00.000Z');
    expect(html).toContain('Proposed due date');
    expect(html).toContain('Review expires');
    expect(html.indexOf('Discuss the inspection')).toBeLessThan(html.indexOf('value="approve"'));
  });
  it('displays exact sender, recipient, subject and body', async () => {
    const { receipt } = await fixture({ recipient: 'client@example.test', sender: 'owner@example.test', subject: 'Inspection details', body: 'Exact reviewed message', captureExactTarget: true });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ proposalId: receipt.proposalId }) }));
    for (const value of ['client@example.test', 'owner@example.test', 'Inspection details', 'Exact reviewed message']) expect(html).toContain(value);
  });
  it.each(['targetResolutionRequired', 'audienceReviewRequired'])('withholds approval while %s remains unresolved', async (flag) => {
    const { receipt } = await fixture({ subject: 'Draft', body: 'Unresolved draft', [flag]: true });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ proposalId: receipt.proposalId }) }));
    expect(html).toContain('Unresolved draft');
    expect(html).toContain('Target review required');
    expect(html).not.toContain('value="approve"');
  });
  it('does not approve an unavailable or altered saved version', async () => {
    const { repository, receipt } = await fixture();
    const original = await repository.getVersion(SAMPLE_WORKSPACE_SCOPE, receipt.proposalId, 1);
    vi.spyOn(repository, 'getVersion').mockResolvedValue({ ...original!, payload: { title: 'Tampered action' } });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ proposalId: receipt.proposalId }) }));
    expect(html).toContain('Approval is disabled');
    expect(html).not.toContain('Tampered action');
    expect(html).not.toContain('value="approve"');
  });
  it('keeps inaccessible exact identities generic and scoped', async () => {
    const { get } = await fixture();
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ proposalId: 'another-workspace-id' }) }));
    expect(get).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, 'another-workspace-id');
    expect(html).toContain('unavailable in the current workspace');
    expect(html).not.toContain('value="approve"');
  });
});
