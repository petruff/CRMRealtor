import { randomUUID } from 'node:crypto';
import type { Contact } from '../domain/contact.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalAutomationRepository } from '../data/omnix-proposal-repository.ts';
import type { NurturePlanAutomationRepository } from '../data/nurture-plan-repository.ts';
import { hashOmnixProposalPayload } from './omnix-proposal-commands.ts';

export async function materializeDueNurturePlans(
  proposals: OmnixProposalAutomationRepository,
  nurture: NurturePlanAutomationRepository,
  scope: WorkspaceScope,
  contacts: readonly Contact[],
  now = new Date(),
  workerId = `nurture-${randomUUID()}`,
) {
  const claimed = await nurture.claimDue(scope, {
    workerId, now: now.toISOString(), leaseSeconds: 90, limit: 50,
  });
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  let materialized = 0;
  let noOps = 0;
  for (const lease of claimed) {
    const contact = contactsById.get(lease.plan.contactId);
    if (!contact) continue;
    const step = lease.plan.currentStep + 1;
    const name = `${contact.preferredName || contact.firstName} ${contact.lastName}`.trim();
    const payload = {
      contactId: contact.id, title: `Nurture follow-up · ${name}`,
      description: `Review relationship context and choose the appropriate personal follow-up for nurture step ${step}.`,
      dueAt: now.toISOString(), nurturePlanId: lease.plan.id, nurtureStep: step,
    };
    const result = await proposals.createSystem(scope, {
      contactId: contact.id, kind: 'task-create', origin: 'deterministic', approvalMode: 'active-member',
      factors: { urgency: 60, leadTemperature: contact.leadType, daysOverdue: 0,
        awaitingReply: false, potentialValueCents: 0 },
      title: `Nurture follow-up with ${name}`,
      rationale: `Nurture step ${step} is due under the approved ${lease.plan.cadenceDays}-day plan.`,
      payload, contentHash: hashOmnixProposalPayload(payload),
      citations: [{ entityType: 'contact', recordId: contact.id,
        factKeys: ['leadType', 'nextTouchAt', 'nurturePlan'], href: `/contacts/${contact.id}` }],
      dueAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      correlationId: randomUUID(), idempotencyKey: `nurture-step:${lease.plan.id}:${step}`,
      createdAt: now.toISOString(),
    });
    await nurture.completeStep(scope, {
      planId: lease.plan.id, workerId, fencingToken: lease.fencingToken,
      expectedVersion: lease.plan.version, proposalId: result.proposalId,
      idempotencyKey: `nurture-step:${lease.plan.id}:${step}:materialized`, occurredAt: now.toISOString(),
    });
    materialized += result.noOp ? 0 : 1;
    noOps += result.noOp ? 1 : 0;
  }
  return { claimed: claimed.length, materialized, noOps };
}
