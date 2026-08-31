import type { CreateTransactionMilestoneInput, InboundResponseSignal, TransactionMilestone, TransactionMilestoneState } from '@/lib/domain/operational-signal';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface OperationalSignalRepository {
  listInbound(scope: WorkspaceScope, options?: { unacknowledgedOnly?: boolean; limit?: number }): Promise<readonly InboundResponseSignal[]>;
  acknowledgeInbound(scope: WorkspaceScope, signalId: string, occurredAt: string): Promise<void>;
  listMilestones(scope: WorkspaceScope, options?: { openOnly?: boolean; limit?: number }): Promise<readonly TransactionMilestone[]>;
  createMilestone(scope: WorkspaceScope, input: CreateTransactionMilestoneInput, occurredAt: string): Promise<TransactionMilestone>;
  transitionMilestone(scope: WorkspaceScope, milestoneId: string, expectedVersion: number, nextState: Exclude<TransactionMilestoneState, 'open'>, idempotencyKey: string, occurredAt: string): Promise<void>;
}
