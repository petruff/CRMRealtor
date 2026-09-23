import { describe, expect, it } from 'vitest';
import { SAMPLE_ASSISTANT_SCOPE, SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import { createMemoryOmnixProposalRepository } from '../data/memory-omnix-proposal-repository.ts';
import {
  createOmnixProposalCommand,
  decideOmnixProposalCommand,
  hashOmnixProposalPayload,
  listOmnixApprovalInboxCommand,
} from './omnix-proposal-commands.ts';

const input = {
  kind: 'task-create' as const, origin: 'deterministic' as const, approvalMode: 'active-member' as const,
  factors: { urgency: 80, leadTemperature: 'hot' as const, daysOverdue: 3, awaitingReply: false, potentialValueCents: 50_000_000 },
  title: 'Call the hot lead', rationale: 'The weekly follow-up is three days overdue.',
  payload: { contactId: 'contact-a', title: 'Call lead', dueAt: '2026-09-01T15:00:00.000Z' },
  citations: [{ entityType: 'contact' as const, recordId: 'contact-a', factKeys: ['leadType', 'nextTouchAt'], href: '/contacts/contact-a' }],
  expiresAt: '2026-09-02T12:00:00.000Z', idempotencyKey: 'nba:contact-a:2026-08-31',
};

describe('Omnix proposal commands', () => {
  it('hashes canonical payload keys consistently', () => {
    expect(hashOmnixProposalPayload({ b: 2, a: 1 })).toBe(hashOmnixProposalPayload({ a: 1, b: 2 }));
  });

  it('persists, ranks, lists, and approves an exact version', async () => {
    const repository = createMemoryOmnixProposalRepository();
    const receipt = await createOmnixProposalCommand(repository, SAMPLE_WORKSPACE_SCOPE, input, new Date('2026-08-31T12:00:00.000Z'));
    const queue = await listOmnixApprovalInboxCommand(repository, SAMPLE_WORKSPACE_SCOPE);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: receipt.proposalId, state: 'pending', priority: 'p1' });
    await expect(decideOmnixProposalCommand(repository, SAMPLE_ASSISTANT_SCOPE, receipt.proposalId, {
      decision: 'approve', expectedVersion: 1, idempotencyKey: 'approve:proposal-a:1',
    }, new Date('2026-08-31T13:00:00.000Z'))).resolves.toMatchObject({ state: 'approved' });
  });

  it('keeps owner-only generated proposals owner-gated', async () => {
    const repository = createMemoryOmnixProposalRepository();
    await expect(createOmnixProposalCommand(repository, SAMPLE_ASSISTANT_SCOPE, {
      ...input, origin: 'gemini', approvalMode: 'owner', idempotencyKey: 'owner-only:1',
    }, new Date('2026-08-31T12:00:00.000Z'))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
