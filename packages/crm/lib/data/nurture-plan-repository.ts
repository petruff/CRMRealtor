import type { NurturePlan, NurturePlanAction } from '../domain/nurture-plan.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface NurturePlanRepository {
  list(scope: WorkspaceScope, input: { readonly contactId?: string; readonly limit: number }): Promise<readonly NurturePlan[]>;
  get(scope: WorkspaceScope, planId: string): Promise<NurturePlan | undefined>;
  create(scope: WorkspaceScope, input: {
    readonly contactId: string;
    readonly sourceProposalId: string;
    readonly cadenceDays: number;
    readonly maximumSteps: number;
    readonly startAt: string;
    readonly idempotencyKey: string;
    readonly occurredAt: string;
  }): Promise<NurturePlan>;
  transition(scope: WorkspaceScope, planId: string, input: {
    readonly expectedVersion: number;
    readonly action: NurturePlanAction;
    readonly snoozedUntil?: string;
    readonly stopReason?: string;
    readonly idempotencyKey: string;
    readonly occurredAt: string;
  }): Promise<NurturePlan>;
}

export interface NurturePlanAutomationRepository {
  claimDue(scope: WorkspaceScope, input: {
    readonly workerId: string;
    readonly now: string;
    readonly leaseSeconds: number;
    readonly limit: number;
  }): Promise<readonly { readonly plan: NurturePlan; readonly fencingToken: number }[]>;
  completeStep(scope: WorkspaceScope, input: {
    readonly planId: string;
    readonly workerId: string;
    readonly fencingToken: number;
    readonly expectedVersion: number;
    readonly proposalId: string;
    readonly idempotencyKey: string;
    readonly occurredAt: string;
  }): Promise<NurturePlan>;
}
