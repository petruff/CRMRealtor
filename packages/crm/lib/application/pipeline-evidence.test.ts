import { describe, expect, it, vi } from 'vitest';
import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { ActivityEvent, CrmTask } from '@/lib/domain/activity';
import type { Contact } from '@/lib/domain/contact';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { buildPipelineEvidence, loadPipelineEvidence } from './pipeline-evidence';

const contact: Contact = {
  id: 'contact-1', firstName: 'Judith', lastName: 'Client', leadType: 'hot',
  relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'active',
  nextTouchAt: '2026-08-20', tags: [], createdAt: '2026-08-01T12:00:00.000Z',
};

const task: CrmTask = {
  id: 'task-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, contactId: contact.id,
  title: 'Confirm inspection', dueAt: '2026-08-14T15:00:00.000Z', status: 'open',
  creatorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
  assigneeMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
  createdAt: '2026-08-12T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z',
};

const event: ActivityEvent = {
  id: 'event-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
  type: 'task-created', contactId: contact.id, taskId: task.id,
  actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
  occurredAt: '2026-08-12T12:00:00.000Z', createdAt: '2026-08-12T12:00:00.000Z',
  idempotencyKey: 'pipeline-evidence-test',
};

describe('pipeline evidence projection', () => {
  it('prefers the earliest authorized open task and retains latest activity source', () => {
    const result = buildPipelineEvidence([contact], [task], [event]);
    expect(result.byContactId[contact.id]?.nextStep).toMatchObject({
      kind: 'task', label: 'Confirm inspection', date: task.dueAt, source: 'Open CRM task',
    });
    expect(result.byContactId[contact.id]?.latestActivity).toMatchObject({
      type: 'task-created', occurredAt: event.occurredAt, source: 'CRM activity history',
    });
  });

  it('fails closed when the scoped task/activity read is unavailable', async () => {
    const repository = {
      listTasks: vi.fn().mockRejectedValue(new Error('forbidden provider detail')),
      listEvents: vi.fn().mockResolvedValue([]),
    } as unknown as ActivityRepository;

    await expect(loadPipelineEvidence(repository, SAMPLE_WORKSPACE_SCOPE, [contact])).resolves.toEqual({
      availability: 'unavailable', byContactId: {},
    });
  });
});
