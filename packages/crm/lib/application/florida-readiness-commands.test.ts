import { describe, expect, it, vi } from 'vitest';
import type { ContactRepository } from '../data/repository.ts';
import type { TransactionRepository } from '../data/transaction-repository.ts';
import { createMemoryOperationalSignalRepository } from '../data/memory-operational-signal-repository.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { recordReadinessCommand } from './florida-readiness-commands.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: '00000000-0000-4000-8000-000000000005',
  workspaceId: '00000000-0000-4000-8000-000000000002', role: 'owner', mode: 'live',
};
const transaction = {
  id: '00000000-0000-4000-8000-000000000003', workspaceId: scope.workspaceId,
  contactId: '00000000-0000-4000-8000-000000000004', contactName: 'Avery Buyer', propertyAddress: '12 Palm Ave',
  grossCommissionCents: 0,
};
const NOW = new Date('2026-09-23T15:00:00.000Z');

function repository() {
  const contacts = { get: vi.fn(async () => undefined) } as unknown as ContactRepository;
  const transactions = { list: vi.fn(async () => [transaction]) } as unknown as TransactionRepository;
  return createMemoryOperationalSignalRepository(contacts, transactions);
}

const base = {
  transactionId: transaction.id, key: 'buyer-agreement' as const, outcome: 'on-file' as const,
  reference: 'Exclusive buyer agreement in Dotloop', sourceDate: '2026-09-20', timeZone: 'America/New_York',
  requestId: '6f1c1d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
};

describe('recordReadinessCommand', () => {
  it('creates a verified, sourced milestone and completes it', async () => {
    const repo = repository();
    const saved = await recordReadinessCommand(repo, scope, base, NOW);
    expect(saved).toMatchObject({ kind: 'buyer-agreement', state: 'completed', verificationState: 'verified', sourceReference: base.reference, sourceType: 'transaction-record', currentVersion: 2 });
  });

  it('completes a scheduled milestone instead of creating a duplicate', async () => {
    const repo = repository();
    const scheduled = await repo.createMilestone(scope, {
      transactionId: transaction.id, kind: 'flood', label: 'Flood disclosure', dueAt: '2026-09-30T15:00:00.000Z', timezone: 'America/New_York',
      responsibleMembershipId: scope.membershipId, sourceType: 'contract', sourceReference: 'Contract', sourceDate: '2026-09-18',
      verificationState: 'unverified', idempotencyKey: '7f1c1d2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    }, NOW.toISOString());
    const saved = await recordReadinessCommand(repo, scope, { ...base, key: 'flood-disclosure' }, NOW);
    expect(saved.id).toBe(scheduled.id);
    expect(saved.state).toBe('completed');
    expect(await repo.listMilestones(scope)).toHaveLength(1);
  });

  it('waives with a reason when the item does not apply', async () => {
    const saved = await recordReadinessCommand(repository(), scope, { ...base, outcome: 'not-applicable', reference: 'Buyer is a relocating employee; brokerage exemption' }, NOW);
    expect(saved).toMatchObject({ state: 'waived', verificationState: 'unverified' });
  });

  it('rejects empty references, future dates and stale forms', async () => {
    await expect(recordReadinessCommand(repository(), scope, { ...base, reference: ' ' }, NOW)).rejects.toThrow(/where the signed document lives/);
    await expect(recordReadinessCommand(repository(), scope, { ...base, sourceDate: '2026-12-01' }, NOW)).rejects.toThrow(/future/);
    await expect(recordReadinessCommand(repository(), scope, { ...base, requestId: 'x' }, NOW)).rejects.toThrow(/expired/);
  });
});
