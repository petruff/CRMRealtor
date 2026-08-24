import type {
  AttentionItem,
  AttentionLifecycleEvent,
  AttentionMaterialization,
  AttentionState,
  AttentionTransitionInput,
} from '../domain/attention.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface AttentionQuery {
  readonly state?: AttentionState | 'active' | 'all';
  readonly assigneeMembershipId?: string;
  readonly limit: number;
  readonly now: string;
}

export interface AttentionReconciliationResult {
  readonly runId: string;
  readonly noOp: boolean;
  readonly materialized: number;
  readonly refreshed: number;
  readonly reopened: number;
  readonly resolved: number;
  readonly active: readonly AttentionItem[];
}

export interface AttentionRepository {
  list(scope: WorkspaceScope, query: AttentionQuery): Promise<readonly AttentionItem[]>;
  get(scope: WorkspaceScope, id: string): Promise<AttentionItem | undefined>;
  transition(
    scope: WorkspaceScope,
    id: string,
    input: AttentionTransitionInput,
  ): Promise<{ item: AttentionItem; event?: AttentionLifecycleEvent; noOp: boolean }>;
  listEvents(
    scope: WorkspaceScope,
    attentionItemId: string,
    limit: number,
  ): Promise<readonly AttentionLifecycleEvent[]>;
}

/** Server-only reconciliation seam. Implementations must not expose it to browser authority. */
export interface AttentionAutomationRepository {
  reconcile(
    scope: WorkspaceScope,
    materializations: readonly AttentionMaterialization[],
    observedAt: string,
    idempotencyKey: string,
  ): Promise<AttentionReconciliationResult>;
}
