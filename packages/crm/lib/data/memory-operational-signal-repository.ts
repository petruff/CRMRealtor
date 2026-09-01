import { randomUUID } from 'node:crypto';
import {
  validateTransactionMilestoneInput,
  validateTransactionMilestoneTransition,
  validateTransactionMilestoneUpdate,
  type InboundResponseSignal,
  type TransactionMilestone,
} from '@/lib/domain/operational-signal';
import { validateWorkspaceScope } from '@/lib/domain/workspace';
import type { ContactRepository } from './repository';
import type { TransactionRepository } from './transaction-repository';
import type { OperationalSignalRepository } from './operational-signal-repository';

export function createMemoryOperationalSignalRepository(
  contacts: ContactRepository,
  transactions: TransactionRepository,
): OperationalSignalRepository {
  const inbound: InboundResponseSignal[] = [];
  const milestones: TransactionMilestone[] = [];
  const keys = new Map<string, TransactionMilestone>();
  return {
    async listInbound(scope, options = {}) {
      validateWorkspaceScope(scope);
      return inbound.filter((row) => row.workspaceId === scope.workspaceId
        && (!options.unacknowledgedOnly || !row.acknowledgedAt)).slice(0, options.limit ?? 500);
    },
    async acknowledgeInbound(scope, id, occurredAt) {
      const row = inbound.find((item) => item.workspaceId === scope.workspaceId && item.id === id);
      if (!row) throw new Error('Inbound response signal not found.');
      Object.assign(row, { acknowledgedAt: occurredAt });
    },
    async listMilestones(scope, options = {}) {
      validateWorkspaceScope(scope);
      return milestones.filter((row) => row.workspaceId === scope.workspaceId
        && (!options.openOnly || row.state === 'open'))
        .sort((left, right) => left.dueAt.localeCompare(right.dueAt)).slice(0, options.limit ?? 1000);
    },
    async createMilestone(scope, raw, occurredAt) {
      const validatedScope = validateWorkspaceScope(scope); const input = validateTransactionMilestoneInput(raw);
      const key = `${validatedScope.workspaceId}:${input.idempotencyKey}`; const replay = keys.get(key);
      if (replay) return replay;
      const transaction = (await transactions.list(validatedScope)).find((row) => row.id === input.transactionId);
      if (!transaction) throw new Error('Transaction not found.');
      const contact = await contacts.get(transaction.contactId);
      const row: TransactionMilestone = {
        id: randomUUID(), workspaceId: validatedScope.workspaceId, transactionId: transaction.id,
        contactId: transaction.contactId,
        contactName: contact ? `${contact.preferredName ?? contact.firstName} ${contact.lastName}`.trim() : transaction.contactName,
        propertyAddress: transaction.propertyAddress, potentialValueCents: transaction.grossCommissionCents,
        kind: input.kind, label: input.label, state: 'open', dueAt: input.dueAt, timezone: input.timezone,
        responsibleMembershipId: input.responsibleMembershipId, source: 'manual', sourceType: input.sourceType,
        sourceReference: input.sourceReference, sourceDate: input.sourceDate,
        verificationState: input.verificationState, currentVersion: 1, createdAt: occurredAt, updatedAt: occurredAt,
      };
      milestones.push(row); keys.set(key, row); return row;
    },
    async updateMilestone(scope, raw, occurredAt) {
      const validatedScope = validateWorkspaceScope(scope); const input = validateTransactionMilestoneUpdate(raw);
      const key = `${validatedScope.workspaceId}:${input.idempotencyKey}`; const replay = keys.get(key);
      if (replay) return replay;
      const index = milestones.findIndex((row) => row.workspaceId === validatedScope.workspaceId && row.id === input.milestoneId);
      const current = milestones[index];
      if (!current || current.currentVersion !== input.expectedVersion || current.state !== 'open') throw new Error('Transaction deadline version conflict.');
      const updated: TransactionMilestone = {
        ...current, kind: input.kind, label: input.label, dueAt: input.dueAt, timezone: input.timezone,
        responsibleMembershipId: input.responsibleMembershipId, sourceType: input.sourceType,
        sourceReference: input.sourceReference, sourceDate: input.sourceDate,
        verificationState: input.verificationState, currentVersion: current.currentVersion + 1, updatedAt: occurredAt,
      };
      milestones[index] = updated; keys.set(key, updated); return updated;
    },
    async transitionMilestone(scope, raw, occurredAt) {
      const validatedScope = validateWorkspaceScope(scope); const input = validateTransactionMilestoneTransition(raw);
      const key = `${validatedScope.workspaceId}:${input.idempotencyKey}`; const replay = keys.get(key);
      if (replay) return replay;
      const index = milestones.findIndex((row) => row.workspaceId === validatedScope.workspaceId && row.id === input.milestoneId);
      const current = milestones[index];
      if (!current || current.currentVersion !== input.expectedVersion || current.state !== 'open') throw new Error('Transaction deadline version conflict.');
      const updated: TransactionMilestone = {
        ...current, state: input.nextState, currentVersion: current.currentVersion + 1,
        completedAt: input.nextState === 'completed' ? occurredAt : undefined, updatedAt: occurredAt,
      };
      milestones[index] = updated; keys.set(key, updated); return updated;
    },
  };
}
