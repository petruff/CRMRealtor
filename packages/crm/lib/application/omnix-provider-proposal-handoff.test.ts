import { describe, expect, it, vi } from 'vitest';
import { createMemoryOmnixProposalRepository } from '../data/memory-omnix-proposal-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import { createOmnixProposalCommand, decideOmnixProposalCommand } from './omnix-proposal-commands.ts';
import { handoffApprovedOmnixProviderProposalCommand } from './omnix-provider-proposal-handoff.ts';

describe('Omnix provider proposal handoff', () => {
  it('creates one governed connector handoff only after exact approval', async () => {
    const proposals = createMemoryOmnixProposalRepository();
    const created = await createOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, {
      contactId: 'contact-1', kind: 'google-email-draft', origin: 'gemini', approvalMode: 'owner',
      factors: { urgency: 70, leadTemperature: 'hot', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
      title: 'Check in', rationale: 'A reviewed follow-up draft is appropriate.',
      payload: { contactId: 'contact-1', subject: 'Checking in', body: 'Hello there.' },
      citations: [{ entityType: 'contact', recordId: 'contact-1', factKeys: ['nextTouchAt'], href: '/contacts/contact-1' }],
      expiresAt: '2026-09-07T12:00:00.000Z', idempotencyKey: 'provider-handoff:1',
    }, new Date('2026-08-31T12:00:00.000Z'));
    const prepare = vi.fn().mockResolvedValue({ executionReference: 'connector-intent:intent-1' });
    await expect(handoffApprovedOmnixProviderProposalCommand(proposals, { prepare }, SAMPLE_WORKSPACE_SCOPE, created.proposalId))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(prepare).not.toHaveBeenCalled();
    await decideOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, created.proposalId, {
      decision: 'approve', expectedVersion: 1, idempotencyKey: 'approve:provider-handoff:1',
    }, new Date('2026-08-31T12:10:00.000Z'));
    await expect(handoffApprovedOmnixProviderProposalCommand(
      proposals, { prepare }, SAMPLE_WORKSPACE_SCOPE, created.proposalId, new Date('2026-08-31T12:11:00.000Z'),
    )).resolves.toMatchObject({ state: 'executed' });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('records a failed handoff without claiming provider success', async () => {
    const proposals = createMemoryOmnixProposalRepository();
    const created = await createOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, {
      kind: 'mailchimp-campaign-draft', origin: 'gemini', approvalMode: 'owner',
      factors: { urgency: 45, leadTemperature: 'unknown', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
      title: 'Monthly update', rationale: 'A campaign draft can be reviewed.',
      payload: { title: 'Monthly update', message: 'Market news', segment: 'all-subscribers' },
      citations: [{ entityType: 'workspace', recordId: SAMPLE_WORKSPACE_SCOPE.workspaceId, factKeys: ['campaign'], href: '/campaigns' }],
      expiresAt: '2026-09-07T12:00:00.000Z', idempotencyKey: 'provider-handoff:2',
    }, new Date('2026-08-31T12:00:00.000Z'));
    await decideOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, created.proposalId, {
      decision: 'approve', expectedVersion: 1, idempotencyKey: 'approve:provider-handoff:2',
    }, new Date('2026-08-31T12:10:00.000Z'));
    await expect(handoffApprovedOmnixProviderProposalCommand(proposals, {
      prepare: vi.fn().mockRejectedValue(Object.assign(new Error('Provider unavailable'), { code: 'provider-disabled' })),
    }, SAMPLE_WORKSPACE_SCOPE, created.proposalId, new Date('2026-08-31T12:11:00.000Z'))).rejects.toThrow('Provider unavailable');
    await expect(proposals.get(SAMPLE_WORKSPACE_SCOPE, created.proposalId))
      .resolves.toMatchObject({ state: 'failed', lastErrorCategory: 'connector.provider-disabled' });
  });
});
