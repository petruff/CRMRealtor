import { createHash, randomUUID } from 'node:crypto';
import type { Contact } from '../domain/contact.ts';
import { displayName } from '../domain/contact.ts';
import type { OmnixCopilotAlert } from '../domain/omnix-copilot.ts';
import {
  scoreOmnixPriority,
  type CreateOmnixProposalInput,
  type OmnixProposalCitation,
  type OmnixRelationshipMemory,
} from '../domain/omnix-operational-brain.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalAutomationRepository } from '../data/omnix-proposal-repository.ts';
import { hashOmnixProposalPayload } from './omnix-proposal-commands.ts';
import { milestoneDaysOverdue, type InboundResponseSignal, type TransactionMilestone } from '../domain/operational-signal.ts';
import type { CrmTask } from '../domain/activity.ts';
import type { NurturePlan } from '../domain/nurture-plan.ts';

const URGENCY = { urgent: 100, high: 80, normal: 55, low: 25 } as const;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function proposalCitations(alert: OmnixCopilotAlert): readonly OmnixProposalCitation[] {
  return alert.citations.flatMap((citation) => {
    const entityType = citation.entityType === 'connector' ? 'connection'
      : citation.entityType === 'contact' || citation.entityType === 'task' || citation.entityType === 'activity'
        ? citation.entityType : undefined;
    return entityType ? [{
      entityType, recordId: citation.recordId, factKeys: citation.factKeys,
      ...(citation.sourceTimestamp ? { sourceTimestamp: citation.sourceTimestamp } : {}),
      href: citation.target,
    } satisfies OmnixProposalCitation] : [];
  });
}

function overdueDays(dueAt: string | undefined, now: Date): number {
  if (!dueAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(dueAt)) / 86_400_000));
}

export function buildNextBestActionProposals(
  contacts: readonly Contact[],
  alerts: readonly OmnixCopilotAlert[],
  now: Date,
): readonly CreateOmnixProposalInput[] {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const candidates = alerts.flatMap((alert) => {
    const contact = contactsById.get(alert.recordId);
    const citations = proposalCitations(alert);
    if (!contact || citations.length === 0 || alert.category === 'celebration' || alert.category === 'mailer') return [];
    const factors = {
      urgency: URGENCY[alert.priority], leadTemperature: contact.leadType,
      daysOverdue: overdueDays(alert.dueAt, now), awaitingReply: false, potentialValueCents: 0,
    } as const;
    const ranked = scoreOmnixPriority(factors);
    const name = displayName(contact);
    const dueAt = alert.dueAt ?? now.toISOString();
    const payload = { contactId: contact.id, title: `Follow up with ${name}`, dueAt, sourceAlertId: alert.id };
    return [{
      contactId: contact.id, kind: 'task-create' as const, origin: 'deterministic' as const,
      approvalMode: 'active-member' as const,
      factors, title: `Follow up with ${name}`, rationale: alert.reason, payload,
      contentHash: hashOmnixProposalPayload(payload), citations, dueAt,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      correlationId: randomUUID(), idempotencyKey: `nba:${alert.occurrenceKey ?? alert.id}`.slice(0, 152),
      createdAt: now.toISOString(),
      _rank: ranked.score,
    }];
  });
  const selected = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const current = selected.get(candidate.contactId);
    if (!current || candidate._rank > current._rank) selected.set(candidate.contactId, candidate);
  }
  return [...selected.values()].map(({ _rank, ...proposal }) => {
    void _rank;
    return proposal;
  });
}

export function buildRelationshipMemories(
  contacts: readonly Contact[],
  selectedProposals: readonly CreateOmnixProposalInput[],
  now: Date,
  evidence: { readonly tasks?: readonly CrmTask[]; readonly inboundResponses?: readonly InboundResponseSignal[]; readonly milestones?: readonly TransactionMilestone[]; readonly nurturePlans?: readonly NurturePlan[] } = {},
): readonly (OmnixRelationshipMemory & { readonly sourceHash: string })[] {
  const proposalByContact = new Map<string, CreateOmnixProposalInput>();
  for (const proposal of selectedProposals) {
    if (!proposal.contactId) continue;
    const current = proposalByContact.get(proposal.contactId);
    if (!current || scoreOmnixPriority(proposal.factors).score > scoreOmnixPriority(current.factors).score) {
      proposalByContact.set(proposal.contactId, proposal);
    }
  }
  return contacts.filter((contact) => !contact.archivedAt).map((contact) => {
    const proposal = proposalByContact.get(contact.id);
    const name = displayName(contact);
    const nextBestAction = proposal?.title ?? `Maintain the ${contact.leadType} follow-up rhythm for ${name}.`;
    const tasks = (evidence.tasks ?? []).filter((task) => task.contactId === contact.id && task.status === 'open');
    const inbound = (evidence.inboundResponses ?? []).filter((signal) => signal.contactId === contact.id && !signal.acknowledgedAt);
    const milestones = (evidence.milestones ?? []).filter((milestone) => milestone.contactId === contact.id && milestone.state === 'open');
    const nurture = (evidence.nurturePlans ?? []).find((plan) => plan.contactId === contact.id && ['active','paused','snoozed'].includes(plan.state));
    const facts = {
      leadType: contact.leadType, relationship: contact.relationship, pipelineStage: contact.pipelineStage,
      lastContactedAt: contact.lastContactedAt ?? null, nextTouchAt: contact.nextTouchAt ?? null,
      updatedAt: contact.updatedAt ?? contact.createdAt, openTaskIds: tasks.map((task) => task.id),
      inboundResponseIds: inbound.map((signal) => signal.id), milestoneVersions: milestones.map((milestone) => [milestone.id,milestone.currentVersion]),
      nurturePlan: nurture ? [nurture.id,nurture.state,nurture.version,nurture.nextStepAt ?? null] : null,
    };
    const supportingCitations: OmnixProposalCitation[] = [
      ...tasks.slice(0, 3).map((task) => ({ entityType: 'task' as const, recordId: task.id, factKeys: ['status','dueAt','assigneeMembershipId'], sourceTimestamp: task.updatedAt, href: `/activities?contactId=${contact.id}` })),
      ...inbound.slice(0, 2).map((signal) => ({ entityType: 'activity' as const, recordId: signal.activityEventId, factKeys: ['direction','providerOccurredAt','contactId'], sourceTimestamp: signal.receivedAt, href: `/contacts/${contact.id}` })),
      ...milestones.slice(0, 3).map((milestone) => ({ entityType: 'transaction' as const, recordId: milestone.transactionId, factKeys: ['milestoneKind','milestoneState','dueAt'], sourceTimestamp: milestone.updatedAt, href: `/transactions#deadline-${milestone.id}` })),
      ...(nurture ? [{ entityType: 'workspace' as const, recordId: nurture.workspaceId, factKeys: ['nurturePlanState','cadenceDays','nextStepAt'], sourceTimestamp: nurture.updatedAt, href: `/nurture#plan-${nurture.id}` }] : []),
    ];
    const context = [tasks.length ? `${tasks.length} open ${tasks.length === 1 ? 'task' : 'tasks'}` : null, inbound.length ? `${inbound.length} incoming ${inbound.length === 1 ? 'reply' : 'replies'} awaiting review` : null, milestones.length ? `${milestones.length} open transaction ${milestones.length === 1 ? 'deadline' : 'deadlines'}` : null, nurture ? `${nurture.state} nurture plan` : null].filter(Boolean).join(', ');
    return {
      contactId: contact.id,
      deterministicSummary: `${name} is a ${contact.leadType} ${contact.relationship.replace('-', ' ')} in ${contact.pipelineStage.replace('-', ' ')}.${context ? ` Current operations: ${context}.` : ''}`,
      nextBestAction,
      citations: [...(proposal?.citations ?? [{
        entityType: 'contact', recordId: contact.id,
        factKeys: ['leadType', 'relationship', 'pipelineStage', 'lastContactedAt', 'nextTouchAt'],
        sourceTimestamp: contact.updatedAt ?? contact.createdAt, href: `/contacts/${contact.id}`,
      }]), ...supportingCitations].slice(0, 20),
      policyVersion: 'omnix-relationship-memory.v1', refreshedAt: now.toISOString(), sourceHash: hash(facts),
    };
  });
}

export function buildOperationalSignalProposals(
  contacts: readonly Contact[],
  inboundResponses: readonly InboundResponseSignal[],
  milestones: readonly TransactionMilestone[],
  now: Date,
): readonly CreateOmnixProposalInput[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const replies = inboundResponses.flatMap((signal) => {
    const contact = contactById.get(signal.contactId); if (!contact || contact.archivedAt) return [];
    const payload = { contactId: contact.id, title: `Reply to ${signal.contactName}`, dueAt: createdAt, sourceSignalId: signal.id };
    return [{ contactId: contact.id, kind: 'task-create' as const, origin: 'deterministic' as const,
      approvalMode: 'active-member' as const, factors: { urgency: 92, leadTemperature: contact.leadType, daysOverdue: overdueDays(signal.receivedAt, now), awaitingReply: true, potentialValueCents: 0 },
      title: `Reply to ${signal.contactName}`, rationale: `An incoming Gmail message was linked to this contact at ${signal.receivedAt}. Omnix has not read or classified the message body.`,
      payload, contentHash: hashOmnixProposalPayload(payload), citations: [{ entityType: 'activity' as const, recordId: signal.activityEventId, factKeys: ['direction', 'providerOccurredAt', 'contactId'], sourceTimestamp: signal.receivedAt, href: `/contacts/${contact.id}` }],
      dueAt: createdAt, expiresAt, correlationId: randomUUID(), idempotencyKey: `inbound-response:${signal.resourceHash}`.slice(0, 152), createdAt }];
  });
  const deadlineHorizon = now.getTime() + 14 * 86_400_000;
  const deadlines = milestones.flatMap((milestone) => {
    const contact = contactById.get(milestone.contactId);
    if (!contact || contact.archivedAt || milestone.state !== 'open' || Date.parse(milestone.dueAt) > deadlineHorizon) return [];
    const payload = { contactId: contact.id, transactionId: milestone.transactionId, title: `${milestone.label} · ${milestone.propertyAddress}`, dueAt: milestone.dueAt, sourceMilestoneId: milestone.id };
    return [{ contactId: contact.id, transactionId: milestone.transactionId, kind: 'task-create' as const,
      origin: 'deterministic' as const, approvalMode: 'active-member' as const,
      factors: { urgency: Date.parse(milestone.dueAt) <= now.getTime() ? 100 : 78, leadTemperature: contact.leadType, daysOverdue: milestoneDaysOverdue(milestone, now), awaitingReply: false, potentialValueCents: milestone.potentialValueCents },
      title: milestone.label, rationale: `${milestone.propertyAddress} has a verified ${milestone.kind} deadline.`, payload,
      contentHash: hashOmnixProposalPayload(payload), citations: [{ entityType: 'transaction' as const, recordId: milestone.transactionId, factKeys: ['milestoneKind', 'milestoneState', 'dueAt', 'grossCommissionCents'], sourceTimestamp: milestone.updatedAt, href: `/transactions#deadline-${milestone.id}` }],
      dueAt: milestone.dueAt, expiresAt: new Date(Math.max(Date.parse(milestone.dueAt) + 7 * 86_400_000, now.getTime() + 86_400_000)).toISOString(), correlationId: randomUUID(), idempotencyKey: `transaction-deadline:${milestone.id}:v${milestone.currentVersion}`, createdAt }];
  });
  return [...replies, ...deadlines];
}

export function selectOneNextBestActionPerContact(
  candidates: readonly CreateOmnixProposalInput[],
): readonly CreateOmnixProposalInput[] {
  const selected = new Map<string, CreateOmnixProposalInput>();
  for (const candidate of candidates) {
    const key = candidate.contactId ?? `unlinked:${candidate.idempotencyKey}`;
    const current = selected.get(key);
    const candidateScore = scoreOmnixPriority(candidate.factors).score;
    const currentScore = current ? scoreOmnixPriority(current.factors).score : -1;
    const candidateDue = candidate.dueAt ?? candidate.expiresAt;
    const currentDue = current?.dueAt ?? current?.expiresAt ?? '';
    if (!current || candidateScore > currentScore
      || (candidateScore === currentScore && (candidateDue < currentDue
        || (candidateDue === currentDue && candidate.idempotencyKey < current.idempotencyKey)))) {
      selected.set(key, candidate);
    }
  }
  return [...selected.values()];
}

export async function materializeOmnixOperationalBrain(
  repository: OmnixProposalAutomationRepository,
  scope: WorkspaceScope,
  contacts: readonly Contact[],
  alerts: readonly OmnixCopilotAlert[],
  inboundResponses: readonly InboundResponseSignal[],
  milestones: readonly TransactionMilestone[],
  tasks: readonly CrmTask[],
  nurturePlans: readonly NurturePlan[],
  now: Date,
) {
  const proposals = selectOneNextBestActionPerContact([
    ...buildNextBestActionProposals(contacts, alerts, now),
    ...buildOperationalSignalProposals(contacts, inboundResponses, milestones, now),
  ]);
  const proposalReceipts = await Promise.all(proposals.map((proposal) => repository.createSystem(scope, proposal)));
  const memories = buildRelationshipMemories(contacts, proposals, now, { tasks, inboundResponses, milestones, nurturePlans });
  await Promise.all(memories.map((memory) => repository.upsertRelationshipMemory(scope, memory)));
  return {
    proposals: proposalReceipts.length,
    proposalNoOps: proposalReceipts.filter((receipt) => receipt.noOp).length,
    memories: memories.length,
  };
}
