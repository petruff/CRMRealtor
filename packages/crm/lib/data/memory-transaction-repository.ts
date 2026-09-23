import { randomUUID } from 'node:crypto';
import type { ContactRepository } from './repository.ts';
import type { TransactionRepository } from './transaction-repository.ts';
import { validateTransactionInput, validateTransactionPartyArchive, validateTransactionPartyInput, validateTransactionPartyUpdate, validateTransactionTransition, validateTransactionUpdate, type RealEstateTransaction, type TransactionParty } from '../domain/transaction.ts';
import { validateFinancialAuthorityInput, type TransactionFinancialAuthority } from '../domain/transaction-finance.ts';
import { validateWorkflowPackDefinition, validateWorkflowStepTransition, type TransactionWorkflowPlan, type TransactionWorkflowStep, type WorkflowPackDefinition } from '../domain/workflow-pack.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';

export function createMemoryTransactionRepository(contacts: ContactRepository, workflowPacks: readonly WorkflowPackDefinition[] = []): TransactionRepository {
  const rows: RealEstateTransaction[] = [];
  const parties: TransactionParty[] = [];
  const financials: TransactionFinancialAuthority[] = [];
  const packs = workflowPacks.map(validateWorkflowPackDefinition);
  const workflowPlans: TransactionWorkflowPlan[] = [];
  const workflowSteps: TransactionWorkflowStep[] = [];
  const idempotency = new Map<string, RealEstateTransaction>();
  const updateIdempotency = new Map<string, RealEstateTransaction>();
  const partyIdempotency = new Map<string, TransactionParty>();
  const partyUpdateIdempotency = new Map<string, TransactionParty>();
  const partyArchiveIdempotency = new Map<string, TransactionParty>();
  const transitionIdempotency = new Map<string, RealEstateTransaction>();
  const financialIdempotency = new Map<string, TransactionFinancialAuthority>();
  const workflowPlanIdempotency = new Map<string, TransactionWorkflowPlan>();
  const workflowStepIdempotency = new Map<string, TransactionWorkflowStep>();
  return {
    async list(untrustedScope) {
      const scope = validateWorkspaceScope(untrustedScope);
      return rows.filter((row) => row.workspaceId === scope.workspaceId);
    },
    async listParties(untrustedScope, transactionIds) {
      const scope = validateWorkspaceScope(untrustedScope);
      const ids = transactionIds ? new Set(transactionIds) : undefined;
      return parties.filter((party) => party.workspaceId === scope.workspaceId && !party.archivedAt
        && (!ids || ids.has(party.transactionId)));
    },
    async listFinancials(untrustedScope, transactionIds) {
      const scope = validateWorkspaceScope(untrustedScope);
      const ids = transactionIds ? new Set(transactionIds) : undefined;
      return financials.filter((item) => item.workspaceId === scope.workspaceId && (!ids || ids.has(item.transactionId)));
    },
    async listWorkflowPacks(untrustedScope) {
      validateWorkspaceScope(untrustedScope);
      return packs;
    },
    async listWorkflowPlans(untrustedScope, transactionIds) {
      const scope = validateWorkspaceScope(untrustedScope); const ids = transactionIds ? new Set(transactionIds) : undefined;
      return workflowPlans.filter((item) => item.workspaceId === scope.workspaceId && (!ids || ids.has(item.transactionId)));
    },
    async listWorkflowSteps(untrustedScope, planIds) {
      const scope = validateWorkspaceScope(untrustedScope); const ids = planIds ? new Set(planIds) : undefined;
      return workflowSteps.filter((item) => item.workspaceId === scope.workspaceId && (!ids || ids.has(item.planId)));
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
        kind: input.kind, kindVerified: true, title: input.title,
        status: input.status, side: input.side, propertyAddress: input.propertyAddress,
        source: contact.source, expectedCloseDate: input.expectedCloseDate, closedAt: input.closedAt,
        salePriceCents: input.salePriceCents, grossCommissionCents: input.grossCommissionCents,
        netCommissionCents: input.netCommissionCents, marketingCostCents: input.marketingCostCents,
        expenseCents: input.expenseCents, responsibleMembershipId: scope.membershipId,
        nextAction: input.nextAction, nextActionDueAt: input.nextActionDueAt, version: 1,
        createdByMembershipId: scope.membershipId,
        createdAt: now, updatedAt: now,
      };
      rows.push(row); idempotency.set(`${scope.workspaceId}:${input.idempotencyKey}`, row);
      return row;
    },
    async update(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateTransactionUpdate(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = updateIdempotency.get(key);
      if (replay) return replay;
      const index = rows.findIndex((row) => row.workspaceId === scope.workspaceId && row.id === input.transactionId);
      const current = rows[index];
      if (!current) throw new Error('Transaction was not found.');
      if (current.version !== input.expectedVersion) throw new Error('Transaction version is stale.');
      const updated: RealEstateTransaction = {
        ...current,
        kind: input.kind,
        kindVerified: true,
        title: input.title,
        side: input.side,
        propertyAddress: input.propertyAddress,
        expectedCloseDate: input.expectedCloseDate,
        salePriceCents: input.salePriceCents,
        grossCommissionCents: input.grossCommissionCents,
        netCommissionCents: input.netCommissionCents,
        marketingCostCents: input.marketingCostCents,
        expenseCents: input.expenseCents,
        nextAction: input.nextAction,
        nextActionDueAt: input.nextActionDueAt,
        version: current.version + 1,
        updatedAt: occurredAt,
      };
      rows[index] = updated;
      updateIdempotency.set(key, updated);
      return updated;
    },
    async addParty(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateTransactionPartyInput(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = partyIdempotency.get(key);
      if (replay) return replay;
      if (!rows.some((row) => row.workspaceId === scope.workspaceId && row.id === input.transactionId)) {
        throw new Error('Transaction was not found.');
      }
      if (input.contactId) {
        const contact = await contacts.get(input.contactId);
        if (!contact || contact.archivedAt) throw new Error('The selected active party contact was not found.');
      }
      const party: TransactionParty = {
        id: randomUUID(), workspaceId: scope.workspaceId, transactionId: input.transactionId,
        contactId: input.contactId, role: input.role, displayLabel: input.displayLabel,
        participatesInCommunication: input.participatesInCommunication, version: 1,
        createdByMembershipId: scope.membershipId, createdAt: occurredAt, updatedAt: occurredAt,
      };
      parties.push(party); partyIdempotency.set(key, party); return party;
    },
    async updateParty(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateTransactionPartyUpdate(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = partyUpdateIdempotency.get(key);
      if (replay) return replay;
      const index = parties.findIndex((party) => party.workspaceId === scope.workspaceId && party.id === input.partyId);
      const current = parties[index];
      if (!current || current.archivedAt) throw new Error('Active transaction party was not found.');
      if (current.version !== input.expectedVersion) throw new Error('Transaction party version is stale.');
      const updated: TransactionParty = {
        ...current,
        role: input.role,
        displayLabel: input.displayLabel,
        participatesInCommunication: input.participatesInCommunication,
        version: current.version + 1,
        updatedAt: occurredAt,
      };
      parties[index] = updated;
      partyUpdateIdempotency.set(key, updated);
      return updated;
    },
    async archiveParty(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateTransactionPartyArchive(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = partyArchiveIdempotency.get(key);
      if (replay) return replay;
      const index = parties.findIndex((party) => party.workspaceId === scope.workspaceId && party.id === input.partyId);
      const current = parties[index];
      if (!current) throw new Error('Transaction party was not found.');
      if (current.archivedAt) return current;
      if (current.version !== input.expectedVersion) throw new Error('Transaction party version is stale.');
      const archived: TransactionParty = {
        ...current,
        archivedAt: occurredAt,
        version: current.version + 1,
        updatedAt: occurredAt,
      };
      parties[index] = archived;
      partyArchiveIdempotency.set(key, archived);
      return archived;
    },
    async upsertFinancials(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateFinancialAuthorityInput(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = financialIdempotency.get(key);
      if (replay) return replay;
      if (!rows.some((row) => row.workspaceId === scope.workspaceId && row.id === input.transactionId)) {
        throw new Error('Transaction was not found.');
      }
      const index = financials.findIndex((item) => item.workspaceId === scope.workspaceId && item.transactionId === input.transactionId);
      const current = financials[index];
      if ((current?.version ?? 0) !== input.expectedVersion) throw new Error('Financial version is stale.');
      const updated: TransactionFinancialAuthority = {
        id: current?.id ?? randomUUID(), workspaceId: scope.workspaceId, transactionId: input.transactionId,
        transactionValueCents: input.transactionValueCents, volumeBasisCents: input.volumeBasisCents,
        grossCommissionCents: input.grossCommissionCents, brokerageSplitCents: input.brokerageSplitCents,
        referralFeeCents: input.referralFeeCents, netCommissionCents: input.netCommissionCents,
        marketingCostCents: input.marketingCostCents, otherExpenseCents: input.otherExpenseCents,
        sourceType: input.sourceType, sourceReference: input.sourceReference, effectiveDate: input.effectiveDate,
        verificationState: input.verificationState, version: input.expectedVersion + 1,
        updatedByMembershipId: scope.membershipId, createdAt: current?.createdAt ?? occurredAt, updatedAt: occurredAt,
      };
      if (index < 0) financials.push(updated); else financials[index] = updated;
      financialIdempotency.set(key, updated);
      return updated;
    },
    async startWorkflowPlan(untrustedScope, input, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = workflowPlanIdempotency.get(key); if (replay) return replay;
      if (!rows.some((row) => row.workspaceId === scope.workspaceId && row.id === input.transactionId)) throw new Error('Transaction was not found.');
      const pack = packs.find((item) => item.id === input.packDefinitionId && item.reviewState === 'reviewed' && item.isCurrent);
      if (!pack) throw new Error('A reviewed current workflow pack is required.');
      const plan: TransactionWorkflowPlan = {
        id: randomUUID(), workspaceId: scope.workspaceId, transactionId: input.transactionId, packDefinitionId: pack.id,
        packType: pack.packType, packName: pack.name, packVersion: pack.version, definitionSnapshot: pack,
        status: 'active', version: 1, startedByMembershipId: scope.membershipId, createdAt: occurredAt, updatedAt: occurredAt,
      };
      workflowPlans.push(plan);
      workflowSteps.push(...pack.steps.map((step) => ({
        id: randomUUID(), workspaceId: scope.workspaceId, planId: plan.id, stepKey: step.key, title: step.title,
        state: 'proposed' as const, responsibleMembershipId: input.responsibleMembershipId,
        evidenceRequirement: step.evidenceRequirement, acknowledgementRequired: step.acknowledgementRequired,
        legalBoundary: step.legalBoundary, version: 1, updatedAt: occurredAt,
      })));
      workflowPlanIdempotency.set(key, plan); return plan;
    },
    async transitionWorkflowStep(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const key = `${scope.workspaceId}:${untrustedInput.idempotencyKey}`;
      const replay = workflowStepIdempotency.get(key); if (replay) return replay;
      const index = workflowSteps.findIndex((item) => item.workspaceId === scope.workspaceId && item.id === untrustedInput.stepId);
      const current = workflowSteps[index]; if (!current) throw new Error('Workflow step was not found.');
      const input = validateWorkflowStepTransition(current, untrustedInput);
      const updated: TransactionWorkflowStep = { ...current, state: input.state, evidenceReference: input.evidenceReference,
        acknowledgedAt: input.acknowledged ? occurredAt : undefined, version: current.version + 1, updatedAt: occurredAt };
      workflowSteps[index] = updated; workflowStepIdempotency.set(key, updated); return updated;
    },
    async transition(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateTransactionTransition(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replay = transitionIdempotency.get(key);
      if (replay) return replay;
      const index = rows.findIndex((row) => row.workspaceId === scope.workspaceId && row.id === input.transactionId);
      const current = rows[index];
      if (!current) throw new Error('Transaction was not found.');
      if (current.version !== input.expectedVersion) throw new Error('Transaction version is stale.');
      const updated: RealEstateTransaction = {
        ...current, status: input.status, closedAt: input.closedAt,
        version: current.version + 1, updatedAt: occurredAt,
      };
      rows[index] = updated; transitionIdempotency.set(key, updated); return updated;
    },
  };
}
