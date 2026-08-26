import { describe, expect, it } from 'vitest';
import { createTaskCommand } from '@/lib/application/activity-commands';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';
import { createMemoryActivityRepository } from './memory-activity-repository';

describe('memory activity repository', () => {
  it('validates every bulk target before changing any task', async () => {
    const repository = createMemoryActivityRepository();
    const created = await createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      title: 'Call', dueAt: '2026-08-12T00:00:00Z', idempotencyKey: 'task-1',
    }, new Date('2026-08-11T00:00:00Z'));
    await expect(repository.transitionTasks(SAMPLE_WORKSPACE_SCOPE, {
      taskIds: [created.task.id, 'missing'], transition: 'complete',
      actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId, transitionedAt: '2026-08-11T01:00:00Z',
    })).rejects.toMatchObject({ code: 'not-found' });
    expect((await repository.getTask(SAMPLE_WORKSPACE_SCOPE, created.task.id))?.status).toBe('open');
  });

  it('does not expose tasks through another workspace scope', async () => {
    const repository = createMemoryActivityRepository();
    const created = await createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      title: 'Call', dueAt: '2026-08-12T00:00:00Z', idempotencyKey: 'task-1',
    });
    const other: WorkspaceScope = {
      ...SAMPLE_WORKSPACE_SCOPE, workspaceId: 'workspace-other', membershipId: 'membership-other',
      authenticatedUserId: 'user-other',
    };
    expect(await repository.getTask(other, created.task.id)).toBeUndefined();
  });

  it('fails closed for assignees that are not in the active membership allowlist', async () => {
    const repository = createMemoryActivityRepository();
    await expect(createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      title: 'Call',
      dueAt: '2026-08-12T00:00:00Z',
      idempotencyKey: 'task-revoked',
      assigneeMembershipId: 'revoked-member',
    })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses new tasks for archived or missing contacts', async () => {
    const repository = createMemoryActivityRepository({ isActiveContact: () => false });
    await expect(createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      contactId: 'contact-archived',
      title: 'Call',
      dueAt: '2026-08-12T00:00:00Z',
      idempotencyKey: 'task-archived-contact',
    })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('returns exact aggregates only for requested visible contacts', async () => {
    const repository = createMemoryActivityRepository({
      initialTasks: [
        {
          id: 'task-open', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, contactId: 'contact-visible',
          title: 'Call', dueAt: '2026-08-12T00:00:00Z', status: 'open',
          creatorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
          assigneeMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
          createdAt: '2026-08-11T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z',
        },
        {
          id: 'task-complete', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, contactId: 'contact-visible',
          title: 'Email', dueAt: '2026-08-12T00:00:00Z', status: 'completed',
          creatorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
          assigneeMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
          createdAt: '2026-08-11T00:00:00Z', updatedAt: '2026-08-11T01:00:00Z',
          completedAt: '2026-08-11T01:00:00Z',
          completedByMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
        },
      ],
      initialEvents: [
        {
          id: 'event-visible', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
          type: 'task-created', contactId: 'contact-visible', taskId: 'task-open',
          actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
          occurredAt: '2026-08-11T00:00:00Z', createdAt: '2026-08-11T00:00:00Z',
          idempotencyKey: 'event-visible',
        },
        {
          id: 'event-hidden', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
          type: 'task-created', contactId: 'contact-hidden', taskId: 'task-hidden',
          actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
          occurredAt: '2026-08-11T00:00:00Z', createdAt: '2026-08-11T00:00:00Z',
          idempotencyKey: 'event-hidden',
        },
      ],
    });

    await expect(repository.listContactAggregates!(
      SAMPLE_WORKSPACE_SCOPE,
      ['contact-visible'],
    )).resolves.toEqual(new Map([['contact-visible', {
      activityCount: 1,
      openTaskCount: 1,
      completedTaskCount: 1,
    }]]));
  });
});
