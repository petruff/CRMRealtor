import { randomUUID } from 'node:crypto';
import type { OperationalSignalRepository } from '../data/operational-signal-repository.ts';
import { proposeTimeline, type TimelineInput } from '../domain/florida-contract-timeline.ts';
import { zonedLocalDateTimeToUtc } from '../domain/operational-signal.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface TimelineResult {
  readonly created: number;
  readonly skipped: number;
}

/**
 * Saves the confirmed contract timeline as sourced milestones due at 11:59 PM
 * local time. A deadline already on the deal (same label, not cancelled) is
 * never duplicated, so saving twice is harmless.
 */
export async function createContractTimelineCommand(
  repository: OperationalSignalRepository,
  scope: WorkspaceScope,
  input: { readonly transactionId: string; readonly timeline: TimelineInput; readonly confirmed: boolean; readonly timeZone: string },
  now = new Date(),
): Promise<TimelineResult> {
  if (!input.confirmed) throw new Error('Confirm the periods match the signed contract before saving.');
  const existing = new Set((await repository.listMilestones(scope, { limit: 500 }))
    .filter((item) => item.transactionId === input.transactionId && item.state !== 'cancelled')
    .map((item) => item.label.toLowerCase()));
  let created = 0;
  let skipped = 0;
  for (const deadline of proposeTimeline(input.timeline)) {
    if (existing.has(deadline.label.toLowerCase())) { skipped += 1; continue; }
    await repository.createMilestone(scope, {
      transactionId: input.transactionId,
      kind: deadline.kind,
      label: deadline.label,
      dueAt: zonedLocalDateTimeToUtc(`${deadline.date}T23:59`, input.timeZone),
      timezone: input.timeZone,
      responsibleMembershipId: scope.membershipId,
      sourceType: 'contract',
      sourceReference: `FR/BAR AS IS contract · Effective Date ${input.timeline.effectiveDate}`,
      sourceDate: input.timeline.effectiveDate,
      verificationState: 'verified',
      idempotencyKey: randomUUID(),
    }, now.toISOString());
    created += 1;
  }
  return { created, skipped };
}
