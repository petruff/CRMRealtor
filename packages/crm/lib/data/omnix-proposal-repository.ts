import type {
  CreateOmnixProposalInput,
  OmnixActionProposal,
  OmnixProposalState,
  OmnixProposalVersion,
  OmnixRelationshipMemory,
} from '../domain/omnix-operational-brain.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface OmnixProposalQuery {
  readonly state?: OmnixProposalState | 'active' | 'all';
  readonly contactId?: string;
  readonly limit: number;
}

export interface OmnixProposalDecision {
  readonly decision: 'approve' | 'reject';
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface OmnixProposalRepository {
  list(scope: WorkspaceScope, query: OmnixProposalQuery): Promise<readonly OmnixActionProposal[]>;
  get(scope: WorkspaceScope, proposalId: string): Promise<OmnixActionProposal | undefined>;
  getVersion(scope: WorkspaceScope, proposalId: string, version: number): Promise<OmnixProposalVersion | undefined>;
  create(scope: WorkspaceScope, input: CreateOmnixProposalInput): Promise<{ proposalId: string; version: number; noOp: boolean }>;
  decide(scope: WorkspaceScope, proposalId: string, input: OmnixProposalDecision): Promise<{ proposalId: string; version: number; state: OmnixProposalState; noOp: boolean }>;
  transitionExecution(scope: WorkspaceScope, proposalId: string, input: {
    readonly expectedState: 'approved' | 'failed' | 'executing';
    readonly nextState: 'executing' | 'executed' | 'failed';
    readonly executionReference?: string;
    readonly errorCategory?: string;
    readonly idempotencyKey: string;
    readonly occurredAt: string;
  }): Promise<{ proposalId: string; state: OmnixProposalState; noOp: boolean }>;
  getRelationshipMemory(scope: WorkspaceScope, contactId: string): Promise<OmnixRelationshipMemory | undefined>;
}

/** Service-only scheduler seam. Browser and end-user clients must never receive this authority. */
export interface OmnixProposalAutomationRepository {
  createSystem(scope: WorkspaceScope, input: CreateOmnixProposalInput): Promise<{ proposalId: string; version: number; noOp: boolean }>;
  upsertRelationshipMemory(
    scope: WorkspaceScope,
    input: OmnixRelationshipMemory & { readonly sourceHash: string },
  ): Promise<void>;
}
