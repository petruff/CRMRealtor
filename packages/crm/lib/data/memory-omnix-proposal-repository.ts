import { randomUUID } from 'node:crypto';
import {
  OmnixOperationalError,
  compareOmnixApprovalQueue,
  validateCreateOmnixProposal,
  type OmnixActionProposal,
  type OmnixProposalVersion,
  type OmnixRelationshipMemory,
} from '../domain/omnix-operational-brain.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalRepository } from './omnix-proposal-repository.ts';

export function createMemoryOmnixProposalRepository(): OmnixProposalRepository {
  const proposals = new Map<string, OmnixActionProposal>();
  const versions = new Map<string, OmnixProposalVersion>();
  const idempotency = new Map<string, string>();
  const memories = new Map<string, OmnixRelationshipMemory>();
  return {
    async list(untrustedScope, query) {
      const scope = validateWorkspaceScope(untrustedScope);
      const allowed = query.state === undefined || query.state === 'active' ? ['pending', 'approved', 'failed'] : undefined;
      return [...proposals.values()].filter((item) => item.workspaceId === scope.workspaceId
        && (!query.contactId || item.contactId === query.contactId)
        && (query.state === 'all' || (allowed ? allowed.includes(item.state) : item.state === query.state)))
        .sort(compareOmnixApprovalQueue).slice(0, query.limit);
    },
    async get(untrustedScope, proposalId) {
      const scope = validateWorkspaceScope(untrustedScope);
      const proposal = proposals.get(proposalId);
      return proposal?.workspaceId === scope.workspaceId ? proposal : undefined;
    },
    async getVersion(untrustedScope, proposalId, version) {
      const scope = validateWorkspaceScope(untrustedScope);
      const proposal = proposals.get(proposalId);
      return proposal?.workspaceId === scope.workspaceId ? versions.get(`${proposalId}:${version}`) : undefined;
    },
    async create(untrustedScope, untrustedInput) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateCreateOmnixProposal(untrustedInput);
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const replayId = idempotency.get(key);
      if (replayId) return { proposalId: replayId, version: 1, noOp: true };
      const id = randomUUID();
      const proposal: OmnixActionProposal = {
        id, workspaceId: scope.workspaceId, ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.transactionId ? { transactionId: input.transactionId } : {}),
        ...(input.attentionItemId ? { attentionItemId: input.attentionItemId } : {}),
        kind: input.kind, state: 'pending', origin: input.origin, approvalMode: input.approvalMode,
        priority: input.priority, priorityScore: input.priorityScore, priorityFactors: input.factors,
        title: input.title, rationale: input.rationale, currentVersion: 1, correlationId: input.correlationId,
        ...(input.dueAt ? { dueAt: input.dueAt } : {}), expiresAt: input.expiresAt,
        createdAt: input.createdAt, updatedAt: input.createdAt,
      };
      proposals.set(id, proposal); idempotency.set(key, id);
      versions.set(`${id}:1`, {
        proposalId: id, version: 1, payload: input.payload, contentHash: input.contentHash,
        citations: input.citations, createdAt: input.createdAt,
      });
      return { proposalId: id, version: 1, noOp: false };
    },
    async decide(untrustedScope, proposalId, input) {
      const scope = validateWorkspaceScope(untrustedScope);
      const proposal = proposals.get(proposalId);
      if (!proposal || proposal.workspaceId !== scope.workspaceId) throw new OmnixOperationalError('not-found', 'Proposal was not found.');
      if (proposal.currentVersion !== input.expectedVersion || proposal.state !== 'pending') {
        throw new OmnixOperationalError('conflict', 'Proposal changed before this decision.');
      }
      if (proposal.approvalMode === 'owner' && scope.role !== 'owner') throw new OmnixOperationalError('forbidden', 'Owner approval is required.');
      const state = Date.parse(proposal.expiresAt) <= Date.parse(input.occurredAt)
        ? 'expired' as const : input.decision === 'approve' ? 'approved' as const : 'rejected' as const;
      proposals.set(proposalId, { ...proposal, state, decidedAt: input.occurredAt, updatedAt: input.occurredAt });
      return { proposalId, version: proposal.currentVersion, state, noOp: false };
    },
    async transitionExecution(untrustedScope, proposalId, input) {
      const scope = validateWorkspaceScope(untrustedScope);
      const proposal = proposals.get(proposalId);
      if (!proposal || proposal.workspaceId !== scope.workspaceId) throw new OmnixOperationalError('not-found', 'Proposal was not found.');
      if (proposal.state !== input.expectedState) throw new OmnixOperationalError('conflict', 'Proposal execution state changed.');
      if (proposal.approvalMode === 'owner' && scope.role !== 'owner') throw new OmnixOperationalError('forbidden', 'Owner authority is required.');
      proposals.set(proposalId, {
        ...proposal, state: input.nextState, updatedAt: input.occurredAt,
        ...(input.executionReference ? { executionReference: input.executionReference } : {}),
        ...(input.nextState === 'executed' ? { executedAt: input.occurredAt } : {}),
        ...(input.errorCategory ? { lastErrorCategory: input.errorCategory } : {}),
      });
      return { proposalId, state: input.nextState, noOp: false };
    },
    async getRelationshipMemory(untrustedScope, contactId) {
      const scope = validateWorkspaceScope(untrustedScope);
      return memories.get(`${scope.workspaceId}:${contactId}`);
    },
  };
}
