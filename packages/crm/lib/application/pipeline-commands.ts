import { ActivityError } from '../domain/activity.ts';
import { PIPELINE_LABEL, type PipelineStage } from '../domain/contact.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { PipelineRepository } from '../data/pipeline-repository.ts';

export const PIPELINE_STAGES = Object.keys(PIPELINE_LABEL) as PipelineStage[];

function stage(value: unknown, field: string): PipelineStage {
  if (typeof value !== 'string' || !PIPELINE_STAGES.includes(value as PipelineStage)) {
    throw new ActivityError('invalid-input', `${field} is invalid.`);
  }
  return value as PipelineStage;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw new ActivityError('invalid-input', `${field} is invalid.`);
  }
  return value.trim();
}

function instant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ActivityError('invalid-input', `${field} is required.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ActivityError('invalid-input', `${field} is invalid.`);
  return parsed.toISOString();
}

export async function moveContactPipelineStageCommand(
  repository: PipelineRepository,
  untrustedScope: WorkspaceScope,
  input: {
    contactId?: unknown;
    fromStage?: unknown;
    toStage?: unknown;
    expectedUpdatedAt?: unknown;
    idempotencyKey?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(untrustedScope);
  const occurredAt = now.toISOString();
  return repository.moveStage(scope, {
    contactId: identifier(input.contactId, 'contactId'),
    fromStage: stage(input.fromStage, 'fromStage'),
    toStage: stage(input.toStage, 'toStage'),
    expectedUpdatedAt: instant(input.expectedUpdatedAt, 'expectedUpdatedAt'),
    actorMembershipId: scope.membershipId,
    occurredAt,
    idempotencyKey: identifier(input.idempotencyKey, 'idempotencyKey'),
  });
}
