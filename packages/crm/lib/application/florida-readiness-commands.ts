import type { OperationalSignalRepository } from '../data/operational-signal-repository.ts';
import { READINESS_DEFINITIONS, type ReadinessKey } from '../domain/florida-readiness.ts';
import type { TransactionMilestone } from '../domain/operational-signal.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface RecordReadinessInput {
  readonly transactionId: string;
  readonly key: ReadinessKey;
  /** 'on-file' = the realtor has the signed/delivered document; 'not-applicable' = waived with a reason. */
  readonly outcome: 'on-file' | 'not-applicable';
  readonly reference: string;
  readonly sourceDate: string;
  readonly timeZone: string;
  readonly requestId: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/u;

/**
 * Records a Florida readiness item as a sourced, audited milestone: reuses an
 * open milestone of the same kind if one was scheduled, otherwise creates one,
 * then completes (or waives) it. Idempotent per request id.
 */
export async function recordReadinessCommand(
  repository: OperationalSignalRepository,
  scope: WorkspaceScope,
  input: RecordReadinessInput,
  now = new Date(),
): Promise<TransactionMilestone> {
  const definition = READINESS_DEFINITIONS[input.key];
  if (!definition) throw new Error('Choose a readiness item.');
  if (input.outcome !== 'on-file' && input.outcome !== 'not-applicable') throw new Error('Choose what happened.');
  const reference = input.reference.trim().replace(/\s+/g, ' ');
  if (reference.length < 2 || reference.length > 240 || CONTROL.test(reference)) {
    throw new Error(input.outcome === 'on-file' ? 'Add where the signed document lives (2–240 characters).' : 'Add why it doesn’t apply (2–240 characters).');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.sourceDate) || Number.isNaN(Date.parse(`${input.sourceDate}T00:00:00Z`))) throw new Error('Choose the document date.');
  if (Date.parse(`${input.sourceDate}T00:00:00Z`) > now.getTime() + 86_400_000) throw new Error('The document date can’t be in the future.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.requestId)) throw new Error('This form expired. Reload and try again.');

  const occurredAt = now.toISOString();
  const existing = (await repository.listMilestones(scope, { openOnly: true, limit: 500 }))
    .find((item) => item.transactionId === input.transactionId && item.kind === definition.milestoneKind && item.state === 'open');
  const milestone = existing ?? await repository.createMilestone(scope, {
    transactionId: input.transactionId,
    kind: definition.milestoneKind,
    label: definition.label,
    dueAt: occurredAt,
    timezone: input.timeZone,
    responsibleMembershipId: scope.membershipId,
    sourceType: 'transaction-record',
    sourceReference: reference,
    sourceDate: input.sourceDate,
    verificationState: input.outcome === 'on-file' ? 'verified' : 'unverified',
    idempotencyKey: input.requestId,
  }, occurredAt);
  const nextState = input.outcome === 'on-file' ? 'completed' : 'waived';
  return repository.transitionMilestone(scope, {
    milestoneId: milestone.id,
    expectedVersion: milestone.currentVersion,
    nextState,
    reasonCode: input.outcome === 'on-file' ? 'readiness-on-file' : 'readiness-not-applicable',
    idempotencyKey: `readiness:${milestone.id}:v${milestone.currentVersion}:${nextState}`,
  }, occurredAt);
}
