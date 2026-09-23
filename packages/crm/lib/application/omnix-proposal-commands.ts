import { createHash, randomUUID } from 'node:crypto';
import {
  OmnixOperationalError,
  validateCreateOmnixProposal,
  type CreateOmnixProposalInput,
} from '../domain/omnix-operational-brain.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalRepository } from '../data/omnix-proposal-repository.ts';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

export function hashOmnixProposalPayload(payload: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
}

export async function createOmnixProposalCommand(
  repository: OmnixProposalRepository,
  scopeInput: WorkspaceScope,
  input: Omit<CreateOmnixProposalInput, 'contentHash' | 'correlationId' | 'createdAt'> & {
    readonly contentHash?: string;
    readonly correlationId?: string;
    readonly createdAt?: string;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const createdAt = input.createdAt ?? now.toISOString();
  const proposal = validateCreateOmnixProposal({
    ...input,
    contentHash: input.contentHash ?? hashOmnixProposalPayload(input.payload),
    correlationId: input.correlationId ?? randomUUID(),
    createdAt,
  });
  if (proposal.approvalMode === 'owner' && scope.role !== 'owner' && proposal.origin !== 'deterministic') {
    throw new OmnixOperationalError('forbidden', 'Only the owner can create owner-only generated proposals.');
  }
  return repository.create(scope, proposal);
}

export async function listOmnixApprovalInboxCommand(
  repository: OmnixProposalRepository,
  scope: WorkspaceScope,
  input: { readonly state?: 'active' | 'all' | 'pending' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'expired' | 'cancelled'; readonly contactId?: string; readonly limit?: number } = {},
) {
  return repository.list(validateWorkspaceScope(scope), {
    state: input.state ?? 'active', contactId: input.contactId, limit: input.limit ?? 100,
  });
}

export async function decideOmnixProposalCommand(
  repository: OmnixProposalRepository,
  scope: WorkspaceScope,
  proposalId: string,
  input: { readonly decision: 'approve' | 'reject'; readonly expectedVersion: number; readonly idempotencyKey: string },
  now = new Date(),
) {
  if (!proposalId.trim()) throw new OmnixOperationalError('invalid-input', 'proposalId is required.');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new OmnixOperationalError('invalid-input', 'expectedVersion is invalid.');
  }
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey)) {
    throw new OmnixOperationalError('invalid-input', 'idempotencyKey is invalid.');
  }
  return repository.decide(validateWorkspaceScope(scope), proposalId.trim(), {
    ...input, occurredAt: now.toISOString(),
  });
}
