import type { CaptureOutcomeProposal } from '../domain/capture-outcome.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
export interface CaptureOutcomeRepository {
  get(scope: WorkspaceScope, id: string): Promise<CaptureOutcomeProposal | undefined>;
  list(scope: WorkspaceScope, contactId?: string): Promise<readonly CaptureOutcomeProposal[]>;
  findByKey(scope: WorkspaceScope, key: string): Promise<CaptureOutcomeProposal | undefined>;
  create(scope: WorkspaceScope, proposal: CaptureOutcomeProposal, key: string): Promise<CaptureOutcomeProposal>;
  /** Compare-and-swap mutable receipt revision; append immutable content version when version advances. */
  save(scope: WorkspaceScope, proposal: CaptureOutcomeProposal, expectedRevision: number): Promise<CaptureOutcomeProposal>;
  appendNote(scope: WorkspaceScope, input: { contactId: string; body: string; proposalId: string; proposalVersion: number; idempotencyKey: string; occurredAt: string }): Promise<{ id: string }>;
}
