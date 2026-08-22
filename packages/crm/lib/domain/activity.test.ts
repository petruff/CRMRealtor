import { describe, expect, it } from 'vitest';
import {
  archiveTask,
  completeTask,
  createActivityEvent,
  reopenTask,
  sortTasksForWorkQueue,
  validateBulkTaskIds,
  type CrmTask,
} from './activity';

function task(id: string, patch: Partial<CrmTask> = {}): CrmTask {
  return {
    id, workspaceId: 'workspace-a', title: id, dueAt: '2026-08-12T12:00:00.000Z', status: 'open',
    creatorMembershipId: 'member-a', assigneeMembershipId: 'member-a',
    createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z', ...patch,
  };
}

describe('activity and task domain', () => {
  it('creates a frozen append-only activity value', () => {
    const event = createActivityEvent({
      id: 'event-1', workspaceId: 'workspace-a', type: 'incomplete-record-converted',
      contactId: 'contact-1', incompleteRecordId: 'incomplete-1', actorMembershipId: 'member-a',
      occurredAt: '2026-08-11T12:00:00Z', createdAt: '2026-08-11T12:00:00Z',
      idempotencyKey: 'conversion-1',
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(event).toMatchObject({ incompleteRecordId: 'incomplete-1', occurredAt: '2026-08-11T12:00:00.000Z' });
  });

  it('completes, reopens and archives with clear no-ops and invalid transition errors', () => {
    const completed = completeTask(task('1'), 'member-a', '2026-08-12T00:00:00.000Z');
    expect(completed.task.status).toBe('completed');
    expect(completeTask(completed.task, 'member-a', '2026-08-13T00:00:00.000Z').noOp).toBe(true);
    expect(reopenTask(completed.task, '2026-08-13T00:00:00.000Z').task).toMatchObject({ status: 'open' });
    const archived = archiveTask(completed.task, 'member-a', '2026-08-14T00:00:00.000Z');
    expect(archived.task.status).toBe('archived');
    expect(() => reopenTask(archived.task, '2026-08-15T00:00:00.000Z')).toThrow(/cannot be reopened/i);
  });

  it('enforces explicit unique bulk IDs and the 100-task bound', () => {
    expect(() => validateBulkTaskIds([])).toThrow(/at least one/i);
    expect(() => validateBulkTaskIds(['task-1', 'task-1'])).toThrow(/unique/i);
    expect(() => validateBulkTaskIds(Array.from({ length: 101 }, (_, index) => `task-${index}`)))
      .toThrow(/100/);
  });

  it('sorts open overdue tasks before future tasks, then due and creation time', () => {
    const now = new Date('2026-08-12T12:00:00.000Z');
    expect(sortTasksForWorkQueue([
      task('future', { dueAt: '2026-08-13T00:00:00.000Z' }),
      task('completed', { status: 'completed', dueAt: '2026-08-10T00:00:00.000Z' }),
      task('overdue-late', { dueAt: '2026-08-12T11:00:00.000Z' }),
      task('overdue-early', { dueAt: '2026-08-11T11:00:00.000Z' }),
    ], now).map((item) => item.id)).toEqual(['overdue-early', 'overdue-late', 'future', 'completed']);
  });
});
