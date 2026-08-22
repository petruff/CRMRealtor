import type { ActivityEvent } from '../domain/activity.ts';
import type { Contact, PipelineStage } from '../domain/contact.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface MovePipelineStageInput {
  readonly contactId: string;
  readonly fromStage: PipelineStage;
  readonly toStage: PipelineStage;
  readonly expectedUpdatedAt: string;
  readonly actorMembershipId: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

export interface PipelineMoveReceipt {
  readonly contact: Contact;
  readonly event?: ActivityEvent;
  readonly noOp: boolean;
}

export interface PipelineRepository {
  moveStage(scope: WorkspaceScope, input: MovePipelineStageInput): Promise<PipelineMoveReceipt>;
}
