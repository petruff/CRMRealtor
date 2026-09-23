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
import type { CaptureOutcomeRepository } from '../data/capture-outcome-repository.ts';
import { CAPTURE_SOURCE_MAX, captureText } from '../domain/capture-outcome.ts';

export interface OmnixInternalExecutionDependencies {
  readonly proposals: OmnixProposalRepository;
  readonly activities: ActivityRepository;
  readonly pipeline: PipelineRepository;
  readonly nurture: NurturePlanRepository;
  readonly operationalSignals?: OperationalSignalRepository;
  readonly captureOutcomes?: CaptureOutcomeRepository;
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
  if (proposal.kind !== 'note-append' && proposal.kind !== 'task-create' && proposal.kind !== 'pipeline-move' && proposal.kind !== 'nurture-plan' && proposal.kind !== 'nurture-transition') {
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
    if (proposal.kind === 'note-append') {
      if (!dependencies.captureOutcomes) throw new OmnixOperationalError('unavailable', 'Capture note persistence is unavailable.');
      const receipt = await dependencies.captureOutcomes.appendNote(scope, {
        contactId: stringField(version.payload, 'contactId'), body: captureText(version.payload.body, CAPTURE_SOURCE_MAX, 'Approved note'),
        proposalId: proposal.id, proposalVersion: proposal.currentVersion,
        idempotencyKey: `omnix:${proposal.id}:${proposal.currentVersion}`, occurredAt: now.toISOString(),
      });
      executionReference = `note:${receipt.id}`;
    } else if (proposal.kind === 'task-create') {
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
    } else if (proposal.kind === 'nurture-transition') {
      const action = stringField(version.payload, 'action');
      if (!['pause', 'resume', 'snooze', 'stop'].includes(action)) throw new OmnixOperationalError('invalid-input', 'Invalid nurture action.');
      const planId = stringField(version.payload, 'planId');
      const target = await dependencies.nurture.get(scope, planId);
      if (!target || target.contactId !== stringField(version.payload, 'contactId')) throw new OmnixOperationalError('not-found', 'The contact nurture plan was not found.');
      const receipt = await dependencies.nurture.transition(scope, planId, {
        expectedVersion: integerField(version.payload, 'expectedVersion', 2147483647), action: action as 'pause' | 'resume' | 'snooze' | 'stop',
        ...(typeof version.payload.snoozedUntil === 'string' ? { snoozedUntil: version.payload.snoozedUntil } : {}),
        ...(typeof version.payload.stopReason === 'string' ? { stopReason: version.payload.stopReason } : {}),
        idempotencyKey: `omnix:${proposal.id}:${proposal.currentVersion}`, occurredAt: now.toISOString(),
      });
      // SQL replay may return the plan's later mutable state; the approved transition owns expectedVersion + 1.
      if (receipt.id !== planId) throw new OmnixOperationalError('conflict', 'The nurture receipt does not match the approved plan.');
      executionReference = `nurture-plan:${receipt.id}:version:${integerField(version.payload, 'expectedVersion', 2147483646) + 1}`;
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
