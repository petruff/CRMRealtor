import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '../domain/contact.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { ContactRepository } from './repository.ts';
import { createMemoryTransactionRepository } from './memory-transaction-repository.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: 'member-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};
const contact = {
  id: '00000000-0000-4000-8000-000000000001', firstName: 'Avery', lastName: 'Stone',
  source: 'referral', pipelineStage: 'new', createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} as Contact;

describe('memory transaction repository', () => {
  it('keeps transaction lifecycle separate from contact pipeline and preserves idempotency', async () => {
    const update = vi.fn();
    const contacts = { get: vi.fn(async (id: string) => id === contact.id ? contact : undefined), update } as unknown as ContactRepository;
    const repository = createMemoryTransactionRepository(contacts);
    const created = await repository.create(scope, {
      contactId: contact.id, kind: 'buyer', title: 'Avery purchase', status: 'under-contract', side: 'buyer',
      propertyAddress: '1 Main Street', salePriceCents: 50000000, grossCommissionCents: 1500000,
      netCommissionCents: 900000, marketingCostCents: 10000, expenseCents: 5000,
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
    });
    expect(created).toMatchObject({ kind: 'buyer', kindVerified: true, version: 1 });
    expect(update).not.toHaveBeenCalled();

    const transitioned = await repository.transition(scope, {
      transactionId: created.id, expectedVersion: 1, status: 'closed', closedAt: '2026-09-30',
      reasonCode: 'closing-confirmed', idempotencyKey: 'transaction-transition:close',
    }, '2026-09-30T18:00:00.000Z');
    expect(transitioned).toMatchObject({ status: 'closed', version: 2 });
    expect(update).not.toHaveBeenCalled();
    await expect(repository.transition(scope, {
      transactionId: created.id, expectedVersion: 1, status: 'lost',
      reasonCode: 'stale-change', idempotencyKey: 'transaction-transition:stale',
    }, '2026-09-30T18:01:00.000Z')).rejects.toThrow(/stale/i);
  });

  it('adds an explicit party without manufacturing a contact identity', async () => {
    const contacts = { get: vi.fn(async (id: string) => id === contact.id ? contact : undefined) } as unknown as ContactRepository;
    const repository = createMemoryTransactionRepository(contacts);
    const transaction = await repository.create(scope, {
      contactId: contact.id, kind: 'referral', title: 'Referral opportunity', status: 'pending', side: 'referral',
      propertyAddress: 'Address pending', salePriceCents: 0, grossCommissionCents: 0, netCommissionCents: 0,
      marketingCostCents: 0, expenseCents: 0, idempotencyKey: '00000000-0000-4000-8000-000000000003',
    });
    const party = await repository.addParty(scope, {
      transactionId: transaction.id, role: 'referring-agent', displayLabel: 'Coastal Realty',
      participatesInCommunication: false, idempotencyKey: 'transaction-party:coastal',
    }, '2026-08-31T20:00:00.000Z');
    expect(party).toMatchObject({ displayLabel: 'Coastal Realty', contactId: undefined, version: 1 });
    expect(await repository.listParties(scope, [transaction.id])).toEqual([party]);
    expect(contacts.get).toHaveBeenCalledTimes(1);
  });

  it('updates transaction details and manages a party with optimistic versions', async () => {
    const contacts = { get: vi.fn(async (id: string) => id === contact.id ? contact : undefined) } as unknown as ContactRepository;
    const repository = createMemoryTransactionRepository(contacts);
    const transaction = await repository.create(scope, {
      contactId: contact.id, kind: 'buyer', title: 'Initial deal', status: 'pending', side: 'buyer',
      propertyAddress: '1 Main Street', salePriceCents: 1, grossCommissionCents: 1, netCommissionCents: 1,
      marketingCostCents: 0, expenseCents: 0, idempotencyKey: '00000000-0000-4000-8000-000000000004',
    });
    const updated = await repository.update(scope, {
      transactionId: transaction.id, expectedVersion: 1, kind: 'listing', title: 'Avery listing', side: 'seller',
      propertyAddress: '2 Main Street', salePriceCents: 2, grossCommissionCents: 2, netCommissionCents: 2,
      marketingCostCents: 1, expenseCents: 1, reasonCode: 'details-corrected', idempotencyKey: 'transaction:update:1',
    }, '2026-09-01T12:00:00.000Z');
    expect(updated).toMatchObject({ kind: 'listing', title: 'Avery listing', version: 2 });
    await expect(repository.update(scope, {
      transactionId: transaction.id, expectedVersion: 1, kind: 'buyer', title: 'Stale', side: 'buyer',
      propertyAddress: '1 Main Street', salePriceCents: 1, grossCommissionCents: 1, netCommissionCents: 1,
      marketingCostCents: 0, expenseCents: 0, reasonCode: 'stale', idempotencyKey: 'transaction:update:stale',
    }, '2026-09-01T12:01:00.000Z')).rejects.toThrow(/stale/i);

    const party = await repository.addParty(scope, {
      transactionId: transaction.id, contactId: contact.id, role: 'co-client', displayLabel: 'Avery Stone',
      participatesInCommunication: false, idempotencyKey: 'party:add:avery',
    }, '2026-09-01T12:02:00.000Z');
    const edited = await repository.updateParty(scope, {
      partyId: party.id, expectedVersion: 1, role: 'seller', displayLabel: 'Avery Stone',
      participatesInCommunication: true, idempotencyKey: 'party:update:avery',
    }, '2026-09-01T12:03:00.000Z');
    expect(edited).toMatchObject({ role: 'seller', participatesInCommunication: true, version: 2 });
    const archived = await repository.archiveParty(scope, {
      partyId: party.id, expectedVersion: 2, reasonCode: 'removed-by-realtor', idempotencyKey: 'party:archive:avery',
    }, '2026-09-01T12:04:00.000Z');
    expect(archived).toMatchObject({ version: 3, archivedAt: '2026-09-01T12:04:00.000Z' });
    expect(await repository.listParties(scope, [transaction.id])).toEqual([]);
  });

  it('keeps sourced financial truth on an independent optimistic version', async () => {
    const contacts = { get: vi.fn(async (id: string) => id === contact.id ? contact : undefined) } as unknown as ContactRepository;
    const repository = createMemoryTransactionRepository(contacts);
    const transaction = await repository.create(scope, {
      contactId: contact.id, kind: 'seller', title: 'Avery sale', status: 'closed', side: 'seller',
      propertyAddress: '3 Main Street', closedAt: '2026-09-01', salePriceCents: 0, grossCommissionCents: 0,
      netCommissionCents: 0, marketingCostCents: 0, expenseCents: 0,
      idempotencyKey: '00000000-0000-4000-8000-000000000005',
    });
    const created = await repository.upsertFinancials(scope, {
      transactionId: transaction.id, expectedVersion: 0, transactionValueCents: 50000000,
      grossCommissionCents: 1500000, sourceType: 'closing-statement', sourceReference: 'Statement page 2',
      effectiveDate: '2026-09-01', verificationState: 'verified', reasonCode: 'closing-reviewed',
      idempotencyKey: 'finance:avery:v1',
    }, '2026-09-01T18:00:00.000Z');
    expect(created).toMatchObject({ version: 1, verificationState: 'verified', netCommissionCents: undefined });
    expect(await repository.listFinancials(scope, [transaction.id])).toEqual([created]);
    await expect(repository.upsertFinancials(scope, {
      transactionId: transaction.id, expectedVersion: 0, sourceType: 'manual-record', sourceReference: 'Stale',
      effectiveDate: '2026-09-01', verificationState: 'unverified', reasonCode: 'stale', idempotencyKey: 'finance:stale',
    }, '2026-09-01T18:01:00.000Z')).rejects.toThrow(/stale/i);
  });
});
