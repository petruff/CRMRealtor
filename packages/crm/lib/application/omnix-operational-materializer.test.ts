import { describe, expect, it } from 'vitest';
import type { Contact } from '../domain/contact.ts';
import type { OmnixCopilotAlert } from '../domain/omnix-copilot.ts';
import { buildNextBestActionProposals, buildOperationalSignalProposals, buildRelationshipMemories, selectOneNextBestActionPerContact } from './omnix-operational-materializer.ts';

const contact: Contact = {
  id: 'contact-a', firstName: 'Alicia', lastName: 'Buyer', leadType: 'hot', relationship: 'lead',
  intent: 'buyer', source: 'referral', pipelineStage: 'contacted', tags: [], createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z', nextTouchAt: '2026-08-28',
};

const alert = (id: string, priority: OmnixCopilotAlert['priority']): OmnixCopilotAlert => ({
  id, rule: 'overdue-follow-up', category: 'follow-up', priority, order: 1,
  reason: 'Follow-up is overdue.', asOf: '2026-08-31T12:00:00.000Z', recordId: contact.id,
  href: `/contacts/${contact.id}`, occurrenceKey: `${id}:contact-a`, dueAt: '2026-08-28T12:00:00.000Z',
  citations: [{ id: `${id}-citation`, schemaVersion: 'citation.v1', entityType: 'contact',
    recordId: contact.id, factKeys: ['leadType', 'nextTouchAt'], responseAsOf: '2026-08-31T12:00:00.000Z',
    target: `/contacts/${contact.id}` }],
});

describe('Omnix operational materializer', () => {
  it('selects one highest-priority next best action per contact', () => {
    const proposals = buildNextBestActionProposals([contact], [alert('normal', 'normal'), alert('urgent', 'urgent')], new Date('2026-08-31T12:00:00.000Z'));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ contactId: contact.id, title: 'Follow up with Alicia Buyer' });
    expect(proposals[0]?.rationale).toBe('Follow-up is overdue.');
  });

  it('builds cited relationship memory even when no action is due', () => {
    const memories = buildRelationshipMemories([contact], [], new Date('2026-08-31T12:00:00.000Z'));
    expect(memories[0]).toMatchObject({
      contactId: contact.id,
      deterministicSummary: 'Alicia Buyer is a hot lead in contacted.',
      nextBestAction: 'Maintain the hot follow-up rhythm for Alicia Buyer.',
    });
    expect(memories[0]?.citations).toHaveLength(1);
  });

  it('summarizes current operational evidence without storing message content', () => {
    const memories = buildRelationshipMemories([contact], [], new Date('2026-08-31T12:00:00.000Z'), {
      tasks: [{ id: 'task-a', workspaceId: 'workspace-a', contactId: contact.id, title: 'Call', dueAt: '2026-09-01T12:00:00Z', status: 'open', creatorMembershipId: 'member-a', assigneeMembershipId: 'member-a', createdAt: '2026-08-30T12:00:00Z', updatedAt: '2026-08-30T12:00:00Z' }],
      inboundResponses: [{ id: 'signal-a', workspaceId: 'workspace-a', contactId: contact.id, activityEventId: 'activity-a', contactName: 'Alicia Buyer', resourceHash: 'a'.repeat(64), receivedAt: '2026-08-31T11:00:00Z', intelligenceState: 'pending', unknowns: [], createdAt: '2026-08-31T11:01:00Z' }],
      milestones: [], nurturePlans: [{ id: 'plan-a', workspaceId: 'workspace-a', contactId: contact.id, sourceProposalId: 'proposal-a', state: 'active', version: 1, cadenceDays: 30, currentStep: 0, maximumSteps: 12, nextStepAt: '2026-09-30T12:00:00Z', createdAt: '2026-08-31T10:00:00Z', updatedAt: '2026-08-31T10:00:00Z' }],
    });
    expect(memories[0]?.deterministicSummary).toContain('1 open task, 1 incoming reply awaiting review, active nurture plan');
    expect(memories[0]?.citations.map((item) => item.entityType)).toEqual(['contact', 'task', 'activity', 'workspace']);
  });

  it('turns minimized inbound metadata and verified deadlines into governed actions', () => {
    const proposals = buildOperationalSignalProposals([contact], [{ id: 'signal-a', workspaceId: 'workspace-a', contactId: contact.id, activityEventId: 'activity-a', contactName: 'Alicia Buyer', resourceHash: 'a'.repeat(64), receivedAt: '2026-08-31T11:00:00.000Z', intelligenceState: 'pending', unknowns: [], createdAt: '2026-08-31T11:01:00.000Z' }], [{ id: 'milestone-a', workspaceId: 'workspace-a', transactionId: 'transaction-a', contactId: contact.id, contactName: 'Alicia Buyer', propertyAddress: '1 Main Street', potentialValueCents: 1_200_000, kind: 'inspection', label: 'Inspection deadline', state: 'open', dueAt: '2026-09-01T17:00:00.000Z', timezone: 'America/New_York', responsibleMembershipId: 'member-a', source: 'manual', sourceType: 'contract', sourceReference: 'Contract section 12', sourceDate: '2026-08-30', verificationState: 'verified', currentVersion: 1, createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' }], new Date('2026-08-31T12:00:00.000Z'));
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({ title: 'Reply to Alicia Buyer', factors: { awaitingReply: true } });
    expect(proposals[0]?.rationale).toContain('has not read or classified the message body');
    expect(proposals[1]).toMatchObject({ transactionId: 'transaction-a', kind: 'google-calendar-event', approvalMode: 'owner', title: 'Inspection deadline', factors: { potentialValueCents: 1_200_000 } });
    expect(selectOneNextBestActionPerContact(proposals)).toHaveLength(1);
    expect(selectOneNextBestActionPerContact(proposals)[0]?.title).toBe('Reply to Alicia Buyer');
  });
});
