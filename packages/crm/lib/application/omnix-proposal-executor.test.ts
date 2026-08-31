import { describe, expect, it } from 'vitest';
import { createMemoryActivityRepository } from '../data/memory-activity-repository.ts';
import { createMemoryOmnixProposalRepository } from '../data/memory-omnix-proposal-repository.ts';
import { createMemoryPipelineRepository } from '../data/memory-pipeline-repository.ts';
import { createMemoryNurturePlanRepository } from '../data/memory-nurture-plan-repository.ts';
import { memoryRepository } from '../data/memory-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import { createOmnixProposalCommand, decideOmnixProposalCommand } from './omnix-proposal-commands.ts';
import { executeApprovedOmnixProposalCommand } from './omnix-proposal-executor.ts';

describe('Omnix proposal executor', () => {
  it('creates an idempotent CRM task only after exact approval', async () => {
    const proposals = createMemoryOmnixProposalRepository();
    const contacts = memoryRepository();
    const activeContactIds = new Set((await contacts.list()).map((contact) => contact.id));
    const activities = createMemoryActivityRepository({
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
      isActiveContact: (id) => activeContactIds.has(id),
    });
    const pipeline = createMemoryPipelineRepository({ contacts, activities });
    const nurture = createMemoryNurturePlanRepository();
    const contact = (await contacts.list())[0];
    expect(contact).toBeDefined();
    const created = await createOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, {
      contactId: contact!.id, kind: 'task-create', origin: 'deterministic', approvalMode: 'active-member',
      factors: { urgency: 90, leadTemperature: contact!.leadType, daysOverdue: 2, awaitingReply: false, potentialValueCents: 0 },
      title: `Follow up with ${contact!.firstName}`, rationale: 'The next touch is overdue.',
      payload: { contactId: contact!.id, title: 'Follow up', dueAt: '2026-09-01T15:00:00.000Z' },
      citations: [{ entityType: 'contact', recordId: contact!.id, factKeys: ['nextTouchAt'], href: `/contacts/${contact!.id}` }],
      expiresAt: '2026-09-02T15:00:00.000Z', idempotencyKey: 'execute-test:1',
    }, new Date('2026-08-31T12:00:00.000Z'));
    await expect(executeApprovedOmnixProposalCommand({ proposals, activities, pipeline, nurture }, SAMPLE_WORKSPACE_SCOPE, created.proposalId))
      .rejects.toMatchObject({ code: 'conflict' });
    await decideOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, created.proposalId, {
      decision: 'approve', expectedVersion: 1, idempotencyKey: 'approve:execute-test:1',
    }, new Date('2026-08-31T12:10:00.000Z'));
    await expect(executeApprovedOmnixProposalCommand({ proposals, activities, pipeline, nurture }, SAMPLE_WORKSPACE_SCOPE, created.proposalId, new Date('2026-08-31T12:11:00.000Z')))
      .resolves.toMatchObject({ state: 'executed' });
    expect(await activities.listTasks(SAMPLE_WORKSPACE_SCOPE, { status: 'open', limit: 10 })).toHaveLength(1);
  });

  it('starts a recoverable nurture plan only after owner approval', async () => {
    const proposals = createMemoryOmnixProposalRepository();
    const contacts = memoryRepository();
    const activeContactIds = new Set((await contacts.list()).map((contact) => contact.id));
    const activities = createMemoryActivityRepository({
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
      isActiveContact: (id) => activeContactIds.has(id),
    });
    const pipeline = createMemoryPipelineRepository({ contacts, activities });
    const nurture = createMemoryNurturePlanRepository();
    const contact = (await contacts.list())[0]!;
    const created = await createOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, {
      contactId: contact.id, kind: 'nurture-plan', origin: 'deterministic', approvalMode: 'owner',
      factors: { urgency: 45, leadTemperature: contact.leadType, daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
      title: `Start nurture for ${contact.firstName}`, rationale: 'A monthly relationship plan is appropriate.',
      payload: { contactId: contact.id, cadenceDays: 30, maximumSteps: 12, startAt: '2026-09-01T15:00:00.000Z' },
      citations: [{ entityType: 'contact', recordId: contact.id, factKeys: ['leadType'], href: `/contacts/${contact.id}` }],
      expiresAt: '2026-09-07T15:00:00.000Z', idempotencyKey: 'execute-nurture:1',
    }, new Date('2026-08-31T12:00:00.000Z'));
    await decideOmnixProposalCommand(proposals, SAMPLE_WORKSPACE_SCOPE, created.proposalId, {
      decision: 'approve', expectedVersion: 1, idempotencyKey: 'approve:execute-nurture:1',
    }, new Date('2026-08-31T12:10:00.000Z'));
    await expect(executeApprovedOmnixProposalCommand(
      { proposals, activities, pipeline, nurture }, SAMPLE_WORKSPACE_SCOPE, created.proposalId,
      new Date('2026-08-31T12:11:00.000Z'),
    )).resolves.toMatchObject({ state: 'executed' });
    await expect(nurture.list(SAMPLE_WORKSPACE_SCOPE, { contactId: contact.id, limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ state: 'active', cadenceDays: 30, maximumSteps: 12 })]);
  });
});
