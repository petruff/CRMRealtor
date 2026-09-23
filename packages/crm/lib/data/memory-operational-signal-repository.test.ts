import { describe, expect, it, vi } from 'vitest';
import type { ContactRepository } from './repository';
import type { TransactionRepository } from './transaction-repository';
import { createMemoryOperationalSignalRepository } from './memory-operational-signal-repository';
import type { WorkspaceScope } from '../domain/workspace';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: '00000000-0000-4000-8000-000000000005',
  workspaceId: '00000000-0000-4000-8000-000000000002', role: 'owner', mode: 'live',
};
const transaction = {
  id: '00000000-0000-4000-8000-000000000003', workspaceId: scope.workspaceId,
  contactId: '00000000-0000-4000-8000-000000000004', contactName: 'Avery Buyer', propertyAddress: '1 Main Street',
  grossCommissionCents: 900000,
};

describe('memory operational signal repository', () => {
  it('keeps sourced deadline corrections, assignments and outcomes versioned and idempotent', async () => {
    const contacts = { get: vi.fn(async () => ({ id: transaction.contactId, firstName: 'Avery', lastName: 'Buyer' })) } as unknown as ContactRepository;
    const transactions = { list: vi.fn(async () => [transaction]) } as unknown as TransactionRepository;
    const repository = createMemoryOperationalSignalRepository(contacts, transactions);
    const created = await repository.createMilestone(scope, {
      transactionId: transaction.id, kind: 'flood', label: 'Flood insurance evidence',
      dueAt: '2026-09-10T17:00:00.000Z', timezone: 'America/New_York',
      responsibleMembershipId: scope.membershipId, sourceType: 'insurance', sourceReference: 'Binder request',
      sourceDate: '2026-09-01', verificationState: 'unverified',
      idempotencyKey: '00000000-0000-4000-8000-000000000006',
    }, '2026-09-01T12:00:00.000Z');
    expect(created).toMatchObject({ kind: 'flood', verificationState: 'unverified', currentVersion: 1 });
    const updated = await repository.updateMilestone(scope, {
      milestoneId: created.id, expectedVersion: 1, kind: 'flood', label: 'Flood insurance evidence',
      dueAt: '2026-09-11T17:00:00.000Z', timezone: 'America/New_York',
      responsibleMembershipId: scope.membershipId, sourceType: 'insurance', sourceReference: 'Issued binder',
      sourceDate: '2026-09-02', verificationState: 'verified', reasonCode: 'binder-issued',
      idempotencyKey: 'deadline:update:flood',
    }, '2026-09-02T12:00:00.000Z');
    expect(updated).toMatchObject({ sourceReference: 'Issued binder', verificationState: 'verified', currentVersion: 2 });
    await expect(repository.updateMilestone(scope, {
      milestoneId: created.id, expectedVersion: 1, kind: 'flood', label: 'Stale', dueAt: created.dueAt,
      timezone: created.timezone, responsibleMembershipId: scope.membershipId, sourceType: 'manual-note',
      sourceReference: 'Stale', sourceDate: '2026-09-01', verificationState: 'unverified', reasonCode: 'stale',
      idempotencyKey: 'deadline:update:stale',
    }, '2026-09-02T12:01:00.000Z')).rejects.toThrow(/version conflict/i);
    const completed = await repository.transitionMilestone(scope, {
      milestoneId: created.id, expectedVersion: 2, nextState: 'completed', reasonCode: 'binder-confirmed',
      idempotencyKey: 'deadline:complete:flood',
    }, '2026-09-03T12:00:00.000Z');
    expect(completed).toMatchObject({ state: 'completed', currentVersion: 3, completedAt: '2026-09-03T12:00:00.000Z' });
    expect(await repository.transitionMilestone(scope, {
      milestoneId: created.id, expectedVersion: 2, nextState: 'completed', reasonCode: 'binder-confirmed',
      idempotencyKey: 'deadline:complete:flood',
    }, '2026-09-03T12:01:00.000Z')).toEqual(completed);
  });
});
