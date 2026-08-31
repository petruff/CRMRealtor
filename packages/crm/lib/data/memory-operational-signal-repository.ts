import { randomUUID } from 'node:crypto';
import { validateTransactionMilestoneInput, type InboundResponseSignal, type TransactionMilestone } from '@/lib/domain/operational-signal';
import { validateWorkspaceScope } from '@/lib/domain/workspace';
import type { ContactRepository } from './repository';
import type { TransactionRepository } from './transaction-repository';
import type { OperationalSignalRepository } from './operational-signal-repository';

export function createMemoryOperationalSignalRepository(contacts: ContactRepository, transactions: TransactionRepository): OperationalSignalRepository {
  const inbound: InboundResponseSignal[] = []; const milestones: TransactionMilestone[] = []; const keys = new Map<string, TransactionMilestone>();
  return {
    async listInbound(scope, options = {}) { validateWorkspaceScope(scope); return inbound.filter((row) => row.workspaceId === scope.workspaceId && (!options.unacknowledgedOnly || !row.acknowledgedAt)).slice(0, options.limit ?? 500); },
    async acknowledgeInbound(scope, id, occurredAt) { const row = inbound.find((item) => item.workspaceId === scope.workspaceId && item.id === id); if (!row) throw new Error('Inbound response signal not found.'); Object.assign(row, { acknowledgedAt: occurredAt }); },
    async listMilestones(scope, options = {}) { validateWorkspaceScope(scope); return milestones.filter((row) => row.workspaceId === scope.workspaceId && (!options.openOnly || row.state === 'open')).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, options.limit ?? 1000); },
    async createMilestone(scope, raw, occurredAt) { const input = validateTransactionMilestoneInput(raw); const key = `${scope.workspaceId}:${input.idempotencyKey}`; const replay = keys.get(key); if (replay) return replay; const transaction = (await transactions.list(scope)).find((row) => row.id === input.transactionId); if (!transaction) throw new Error('Transaction not found.'); const contact = await contacts.get(transaction.contactId); const row: TransactionMilestone = { id: randomUUID(), workspaceId: scope.workspaceId, transactionId: transaction.id, contactId: transaction.contactId, contactName: contact ? `${contact.preferredName ?? contact.firstName} ${contact.lastName}`.trim() : transaction.contactName, propertyAddress: transaction.propertyAddress, potentialValueCents: transaction.grossCommissionCents, kind: input.kind, label: input.label, state: 'open', dueAt: input.dueAt, responsibleMembershipId: scope.membershipId, source: 'manual', currentVersion: 1, createdAt: occurredAt, updatedAt: occurredAt }; milestones.push(row); keys.set(key, row); return row; },
    async transitionMilestone(scope, id, expectedVersion, nextState, _key, occurredAt) { const index = milestones.findIndex((row) => row.workspaceId === scope.workspaceId && row.id === id); const row = milestones[index]; if (!row || row.currentVersion !== expectedVersion || row.state !== 'open') throw new Error('Transaction deadline version conflict.'); milestones[index] = { ...row, state: nextState, currentVersion: row.currentVersion + 1, completedAt: nextState === 'completed' ? occurredAt : undefined, updatedAt: occurredAt }; },
  };
}
