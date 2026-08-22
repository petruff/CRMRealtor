import { describe, expect, it } from 'vitest';
import { createMemoryActivityRepository } from '@/lib/data/memory-activity-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import {
  appendActivityEventCommand,
  createTaskCommand,
  listActivityEventsCommand,
  listTasksCommand,
  transitionTasksCommand,
} from './activity-commands';

const now = new Date('2026-08-11T12:00:00.000Z');

describe('activity commands', () => {
  it('creates tasks and their immutable event idempotently', async () => {
    const repository = createMemoryActivityRepository();
    const input = {
      title: 'Call seller', dueAt: '2026-08-12T12:00:00.000Z', idempotencyKey: 'task-request-1',
    };
    const first = await createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, input, now);
    const replay = await createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, input, now);
    expect(first).toMatchObject({ noOp: false, task: { id: 'task-0001' }, event: { type: 'task-created' } });
    expect(replay).toMatchObject({ noOp: true, task: { id: 'task-0001' } });
    expect(await listActivityEventsCommand(repository, SAMPLE_WORKSPACE_SCOPE)).toHaveLength(1);
  });

  it('bulk-completes an explicit set and returns clear replay no-ops', async () => {
    const repository = createMemoryActivityRepository();
    const first = await createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      title: 'First', dueAt: '2026-08-10T12:00:00Z', idempotencyKey: 'task-1',
    }, now);
    const second = await createTaskCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      title: 'Second', dueAt: '2026-08-13T12:00:00Z', idempotencyKey: 'task-2',
    }, now);
    const ids = [first.task.id, second.task.id];
    const completed = await transitionTasksCommand(repository, SAMPLE_WORKSPACE_SCOPE, ids, 'complete', now);
    expect(completed.events.map((event) => event.type)).toEqual(['task-completed', 'task-completed']);
    expect((await transitionTasksCommand(repository, SAMPLE_WORKSPACE_SCOPE, ids, 'complete', now)).noOpTaskIds)
      .toEqual(ids);
    expect(await listTasksCommand(repository, SAMPLE_WORKSPACE_SCOPE, { status: 'completed' })).toHaveLength(2);
  });

  it('deduplicates activity events by workspace key and rejects divergent replay', async () => {
    const repository = createMemoryActivityRepository();
    const base = { type: 'touch-recorded' as const, contactId: 'contact-1', idempotencyKey: 'touch-1' };
    expect((await appendActivityEventCommand(repository, SAMPLE_WORKSPACE_SCOPE, base, now)).noOp).toBe(false);
    expect((await appendActivityEventCommand(repository, SAMPLE_WORKSPACE_SCOPE, base, now)).noOp).toBe(true);
    await expect(appendActivityEventCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      ...base, contactId: 'contact-2',
    }, now)).rejects.toThrow(/different data/i);
  });
});
