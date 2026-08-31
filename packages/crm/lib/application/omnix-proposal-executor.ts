import { createTaskCommand } from './activity-commands.ts';
import { moveContactPipelineStageCommand } from './pipeline-commands.ts';
import { hashOmnixProposalPayload } from './omnix-proposal-commands.ts';
import { OmnixOperationalError } from '../domain/omnix-operational-brain.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { ActivityRepository } from '../data/activity-repository.ts';
import type { OmnixProposalRepository } from '../data/omnix-proposal-repository.ts';
import type { PipelineRepository } from '../data/pipeline-repository.ts';
import type { NurturePlanRepository } from '../data/nurture-plan-repository.ts';
import type { OperationalSignalRepository } from '../data/operational-signal-repository.ts';

export interface OmnixInternalExecutionDependencies {
  readonly proposals: OmnixProposalRepository;
  readonly activities: ActivityRepository;
  readonly pipeline: PipelineRepository;
  readonly nurture: NurturePlanRepository;
  readonly operationalSignals?: OperationalSignalRepository;
}

function stringField(payload: Readonly<Record<string, unknown>>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new OmnixOperationalError('invalid-input', `Approved proposal field ${field} is invalid.`);
  }
  return value.trim();
}

function integerField(payload: Readonly<Record<string, unknown>>, field: string, maximum: number): number {
  const value = payload[field];
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new OmnixOperationalError('invalid-input', `Approved proposal field ${field} is invalid.`);
  }
  return Number(value);
}

function errorCategory(error: unknown): string {
  if (error instanceof OmnixOperationalError) return `proposal.${error.code}`;
  const candidate = error as { code?: unknown };
  return typeof candidate?.code === 'string' && /^[a-z][a-z0-9_.-]{1,60}$/.test(candidate.code)
    ? `crm.${candidate.code}` : 'crm.execution-failed';
}

export async function executeApprovedOmnixProposalCommand(
  dependencies: OmnixInternalExecutionDependencies,
  scope: WorkspaceScope,
  proposalId: string,
  now = new Date(),
) {
  const proposal = await dependencies.proposals.get(scope, proposalId);
  if (!proposal) throw new OmnixOperationalError('not-found', 'Approved proposal was not found.');
  if (proposal.state !== 'approved' && proposal.state !== 'executing') {
    throw new OmnixOperationalError('conflict', 'Proposal is not approved for execution.');
  }
  if (proposal.kind !== 'task-create' && proposal.kind !== 'pipeline-move' && proposal.kind !== 'nurture-plan') {
    throw new OmnixOperationalError('unavailable', 'This approved provider action requires its connector handoff.');
  }
  const version = await dependencies.proposals.getVersion(scope, proposal.id, proposal.currentVersion);
  if (!version || hashOmnixProposalPayload(version.payload) !== version.contentHash) {
    throw new OmnixOperationalError('conflict', 'Proposal content changed before execution.');
  }
  const baseKey = `execute:${proposal.id}:${proposal.currentVersion}`;
  if (proposal.state === 'approved') {
    await dependencies.proposals.transitionExecution(scope, proposal.id, {
      expectedState: 'approved', nextState: 'executing', idempotencyKey: `${baseKey}:claim`,
      occurredAt: now.toISOString(),
    });
  }
  try {
    let executionReference: string;
    if (proposal.kind === 'task-create') {
      const receipt = await createTaskCommand(dependencies.activities, scope, {
        contactId: stringField(version.payload, 'contactId'),
        title: stringField(version.payload, 'title'),
        dueAt: stringField(version.payload, 'dueAt'),
        description: typeof version.payload.description === 'string' ? version.payload.description : proposal.rationale,
        idempotencyKey: `omnix:${proposal.id}:${proposal.currentVersion}`,
      }, now);
      if (dependencies.operationalSignals && typeof version.payload.sourceSignalId === 'string') {
        await dependencies.operationalSignals.acknowledgeInbound(scope, version.payload.sourceSignalId, now.toISOString());
      }
      executionReference = `task:${receipt.task.id}`;
    } else if (proposal.kind === 'pipeline-move') {
      const receipt = await moveContactPipelineStageCommand(dependencies.pipeline, scope, {
        contactId: stringField(version.payload, 'contactId'),
        fromStage: stringField(version.payload, 'fromStage'),
        toStage: stringField(version.payload, 'toStage'),
        expectedUpdatedAt: stringField(version.payload, 'expectedUpdatedAt'),
        idempotencyKey: `omnix-${proposal.id}-${proposal.currentVersion}`,
      }, now);
      executionReference = `contact:${receipt.contact.id}:pipeline:${receipt.contact.pipelineStage}`;
    } else {
      const plan = await dependencies.nurture.create(scope, {
        contactId: stringField(version.payload, 'contactId'), sourceProposalId: proposal.id,
        cadenceDays: integerField(version.payload, 'cadenceDays', 365),
        maximumSteps: integerField(version.payload, 'maximumSteps', 120),
        startAt: stringField(version.payload, 'startAt'),
        idempotencyKey: `omnix:${proposal.id}:${proposal.currentVersion}`,
        occurredAt: now.toISOString(),
      });
      executionReference = `nurture-plan:${plan.id}`;
    }
    return dependencies.proposals.transitionExecution(scope, proposal.id, {
      expectedState: 'executing', nextState: 'executed', executionReference,
      idempotencyKey: `${baseKey}:complete`, occurredAt: now.toISOString(),
    });
  } catch (error) {
    await dependencies.proposals.transitionExecution(scope, proposal.id, {
      expectedState: 'executing', nextState: 'failed', errorCategory: errorCategory(error),
      idempotencyKey: `${baseKey}:failed`, occurredAt: now.toISOString(),
    }).catch(() => undefined);
    throw error;
  }
}
