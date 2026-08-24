import { randomUUID } from 'node:crypto';
import type { ContactRepository } from './repository.ts';
import type { TransactionRepository } from './transaction-repository.ts';
import { validateTransactionInput, type RealEstateTransaction } from '../domain/transaction.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';

export function createMemoryTransactionRepository(contacts: ContactRepository): TransactionRepository {
  const rows: RealEstateTransaction[] = [];
  const idempotency = new Map<string, RealEstateTransaction>();
  return {
    async list(untrustedScope) {
      const scope = validateWorkspaceScope(untrustedScope);
      return rows.filter((row) => row.workspaceId === scope.workspaceId);
    },
    async create(untrustedScope, untrustedInput) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateTransactionInput(untrustedInput);
      const replay = idempotency.get(`${scope.workspaceId}:${input.idempotencyKey}`);
      if (replay) return replay;
      const contact = await contacts.get(input.contactId);
      if (!contact || contact.archivedAt) throw new Error('The selected active contact was not found.');
      const now = new Date().toISOString();
      const row: RealEstateTransaction = {
        id: randomUUID(), workspaceId: scope.workspaceId, contactId: contact.id,
        contactName: `${contact.preferredName ?? contact.firstName} ${contact.lastName}`.trim(),
        status: input.status, side: input.side, propertyAddress: input.propertyAddress,
        source: contact.source, expectedCloseDate: input.expectedCloseDate, closedAt: input.closedAt,
        salePriceCents: input.salePriceCents, grossCommissionCents: input.grossCommissionCents,
        netCommissionCents: input.netCommissionCents, marketingCostCents: input.marketingCostCents,
        expenseCents: input.expenseCents, createdByMembershipId: scope.membershipId,
        createdAt: now, updatedAt: now,
      };
      rows.push(row); idempotency.set(`${scope.workspaceId}:${input.idempotencyKey}`, row);
      if (input.status === 'under-contract' || input.status === 'closed') {
        await contacts.update(contact.id, { pipelineStage: input.status, updatedAt: now });
      }
      return row;
    },
  };
}
