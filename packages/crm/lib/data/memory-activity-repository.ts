import {
  ActivityError,
  archiveTask,
  completeTask,
  createActivityEvent,
  parseInstant,
  parseOptionalIdentifier,
  parseTaskDescription,
  parseTaskTitle,
  reopenTask,
  sortTasksForWorkQueue,
  type ActivityEvent,
  type CrmTask,
} from '../domain/activity.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ActivityRepository, AppendActivityEventInput } from './activity-repository.ts';

export interface MemoryActivityRepositoryOptions {
  readonly initialTasks?: readonly CrmTask[];
  readonly initialEvents?: readonly ActivityEvent[];
  readonly activeMembershipIds?: readonly string[];
  readonly isActiveContact?: (contactId: string) => boolean;
  readonly taskIdPrefix?: string;
  readonly eventIdPrefix?: string;
}

function cloneEvent(event: ActivityEvent): ActivityEvent {
  return Object.freeze({ ...event });
}

function cloneTask(task: CrmTask): CrmTask {
  return { ...task };
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

export function createMemoryActivityRepository(
  options: MemoryActivityRepositoryOptions = {},
): ActivityRepository {
  const tasks = (options.initialTasks ?? []).map(cloneTask);
  const events = (options.initialEvents ?? []).map((event) => createActivityEvent(event));
  const eventFingerprints = new Map<string, string>();
  const taskFingerprints = new Map<string, string>();
  let taskSequence = tasks.length + 1;
  let eventSequence = events.length + 1;
  const taskIdPrefix = options.taskIdPrefix ?? 'task';
  const eventIdPrefix = options.eventIdPrefix ?? 'activity';
  for (const event of events) {
    eventFingerprints.set(`${event.workspaceId}:${event.idempotencyKey}`, fingerprint({
      type: event.type,
      contactId: event.contactId,
      taskId: event.taskId,
      incompleteRecordId: event.incompleteRecordId,
      actorMembershipId: event.actorMembershipId,
      occurredAt: event.occurredAt,
      metadata: event.metadata,
    }));
  }

  function scope(value: WorkspaceScope): WorkspaceScope {
    return validateWorkspaceScope(value);
  }

  function actor(value: WorkspaceScope, actorMembershipId: string): WorkspaceScope {
    const authorized = scope(value);
    if (actorMembershipId !== authorized.membershipId) {
      throw new ActivityError('forbidden', 'Actor does not match authenticated workspace membership.');
    }
    return authorized;
  }

  function activeMembership(value: string, authorized: WorkspaceScope): string {
    const membershipId = parseOptionalIdentifier(value, 'assigneeMembershipId');
    if (!membershipId) throw new ActivityError('invalid-input', 'Assignee membership is required.');
    const activeMembershipIds = options.activeMembershipIds ?? [authorized.membershipId];
    if (!activeMembershipIds.includes(membershipId)) {
      throw new ActivityError('forbidden', 'Assignee must be an active workspace member.');
    }
    return membershipId;
  }

  function eventResult(
    authorized: WorkspaceScope,
    input: AppendActivityEventInput,
  ): { event: ActivityEvent; noOp: boolean } {
    const replayKey = `${authorized.workspaceId}:${input.idempotencyKey}`;
    const inputFingerprint = fingerprint(input);
    const known = eventFingerprints.get(replayKey);
    const existing = events.find((event) => (
      event.workspaceId === authorized.workspaceId && event.idempotencyKey === input.idempotencyKey
    ));
    if (existing) {
      if (known !== inputFingerprint) {
        throw new ActivityError('conflict', 'Activity idempotency key was reused with different data.');
      }
      return { event: cloneEvent(existing), noOp: true };
    }
    const created = createActivityEvent({
      id: `${eventIdPrefix}-${String(eventSequence++).padStart(4, '0')}`,
      workspaceId: authorized.workspaceId,
      type: input.type,
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.incompleteRecordId ? { incompleteRecordId: input.incompleteRecordId } : {}),
      actorMembershipId: input.actorMembershipId,
      occurredAt: input.occurredAt,
      createdAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    events.push(created);
    eventFingerprints.set(replayKey, inputFingerprint);
    return { event: cloneEvent(created), noOp: false };
  }

  return {
    async listEvents(workspaceScope, query) {
      const authorized = scope(workspaceScope);
      return events
        .filter((event) => event.workspaceId === authorized.workspaceId)
        .filter((event) => !query.contactId || event.contactId === query.contactId)
        .filter((event) => !query.taskId || event.taskId === query.taskId)
        .filter((event) => !query.type || event.type === query.type)
        .filter((event) => !query.from || event.occurredAt >= query.from)
        .filter((event) => !query.to || event.occurredAt <= query.to)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
        .slice(0, query.limit)
        .map(cloneEvent);
    },

    async appendEvent(workspaceScope, input) {
      const authorized = actor(workspaceScope, input.actorMembershipId);
      return eventResult(authorized, input);
    },

    async listTasks(workspaceScope, query) {
      const authorized = scope(workspaceScope);
      const needle = query.query?.trim().toLowerCase();
      const selected = tasks
        .filter((task) => task.workspaceId === authorized.workspaceId)
        .filter((task) => query.status === 'all' || !query.status || task.status === query.status)
        .filter((task) => !query.contactId || task.contactId === query.contactId)
        .filter((task) => !query.assigneeMembershipId || task.assigneeMembershipId === query.assigneeMembershipId)
        .filter((task) => !query.dueFrom || task.dueAt >= query.dueFrom)
        .filter((task) => !query.dueTo || task.dueAt <= query.dueTo)
        .filter((task) => !needle || `${task.title} ${task.description ?? ''}`.toLowerCase().includes(needle));
      return sortTasksForWorkQueue(selected).slice(0, query.limit).map(cloneTask);
    },

    async getTask(workspaceScope, id) {
      const authorized = scope(workspaceScope);
      const task = tasks.find((row) => row.id === id && row.workspaceId === authorized.workspaceId);
      return task ? cloneTask(task) : undefined;
    },

    async createTask(workspaceScope, input) {
      const authorized = actor(workspaceScope, input.creatorMembershipId);
      const replayKey = `${authorized.workspaceId}:${input.idempotencyKey}`;
      const inputFingerprint = fingerprint(input);
      const known = taskFingerprints.get(replayKey);
      const replayEvent = events.find((event) => (
        event.workspaceId === authorized.workspaceId
        && event.idempotencyKey === `task-create:${input.idempotencyKey}`
      ));
      if (known) {
        if (known !== inputFingerprint || !replayEvent?.taskId) {
          throw new ActivityError('conflict', 'Task idempotency key was reused with different data.');
        }
        const replayTask = tasks.find((task) => task.id === replayEvent.taskId);
        if (!replayTask) throw new ActivityError('conflict', 'Task replay receipt is incomplete.');
        return { task: cloneTask(replayTask), event: cloneEvent(replayEvent), noOp: true };
      }
      const createdAt = parseInstant(input.createdAt, 'createdAt');
      const contactId = input.contactId ? parseOptionalIdentifier(input.contactId, 'contactId') : undefined;
      if (contactId && options.isActiveContact && !options.isActiveContact(contactId)) {
        throw new ActivityError('conflict', 'Archived or missing contacts cannot receive new tasks.');
      }
      const task: CrmTask = {
        id: `${taskIdPrefix}-${String(taskSequence++).padStart(4, '0')}`,
        workspaceId: authorized.workspaceId,
        ...(contactId ? { contactId } : {}),
        title: parseTaskTitle(input.title),
        ...(parseTaskDescription(input.description) ? { description: parseTaskDescription(input.description) } : {}),
        dueAt: parseInstant(input.dueAt, 'dueAt'),
        status: 'open',
        creatorMembershipId: authorized.membershipId,
        assigneeMembershipId: activeMembership(input.assigneeMembershipId, authorized),
        createdAt,
        updatedAt: createdAt,
      };
      const event = eventResult(authorized, {
        type: 'task-created',
        ...(task.contactId ? { contactId: task.contactId } : {}),
        taskId: task.id,
        actorMembershipId: authorized.membershipId,
        occurredAt: createdAt,
        idempotencyKey: `task-create:${input.idempotencyKey}`,
      });
      tasks.push(task);
      taskFingerprints.set(replayKey, inputFingerprint);
      return { task: cloneTask(task), event: event.event, noOp: false };
    },

    async transitionTasks(workspaceScope, input) {
      const authorized = actor(workspaceScope, input.actorMembershipId);
      const selected = input.taskIds.map((id) => {
        const index = tasks.findIndex((task) => (
          task.id === id && task.workspaceId === authorized.workspaceId
        ));
        const task = tasks[index];
        if (index < 0 || !task) {
          throw new ActivityError('not-found', 'One or more tasks were not found in this workspace.');
        }
        return { index, task };
      });
      const transitionedAt = parseInstant(input.transitionedAt, 'transitionedAt');
      const previews = selected.map(({ index, task }) => {
        const result = input.transition === 'complete'
          ? completeTask(task, authorized.membershipId, transitionedAt)
          : input.transition === 'archive'
            ? archiveTask(task, authorized.membershipId, transitionedAt)
            : reopenTask(task, transitionedAt);
        return { index, ...result };
      });
      const plannedEvents = previews.flatMap((preview): AppendActivityEventInput[] => {
        if (preview.noOp || input.transition === 'reopen') return [];
        return [{
          type: input.transition === 'complete' ? 'task-completed' : 'task-archived',
          ...(preview.task.contactId ? { contactId: preview.task.contactId } : {}),
          taskId: preview.task.id,
          actorMembershipId: authorized.membershipId,
          occurredAt: transitionedAt,
          idempotencyKey: `task-${input.transition}:${preview.task.id}:${transitionedAt}`,
        }];
      });
      for (const planned of plannedEvents) {
        const replayKey = `${authorized.workspaceId}:${planned.idempotencyKey}`;
        const known = eventFingerprints.get(replayKey);
        const existing = events.find((event) => (
          event.workspaceId === authorized.workspaceId && event.idempotencyKey === planned.idempotencyKey
        ));
        if (existing && known !== fingerprint(planned)) {
          throw new ActivityError('conflict', 'Activity idempotency key was reused with different data.');
        }
      }
      const createdEvents: ActivityEvent[] = [];
      for (const preview of previews) {
        tasks[preview.index] = preview.task;
        if (preview.noOp || input.transition === 'reopen') continue;
        const planned = plannedEvents.find((event) => event.taskId === preview.task.id);
        if (!planned) throw new ActivityError('conflict', 'Task transition event plan is incomplete.');
        const event = eventResult(authorized, planned);
        createdEvents.push(event.event);
      }
      return {
        tasks: previews.map((preview) => cloneTask(preview.task)),
        events: createdEvents,
        noOpTaskIds: previews.filter((preview) => preview.noOp).map((preview) => preview.task.id),
      };
    },
    async runTransaction(operation) {
      const tasksBefore = tasks.map(cloneTask);
      const eventsBefore = events.map(cloneEvent);
      const eventFingerprintsBefore = new Map(eventFingerprints);
      const taskFingerprintsBefore = new Map(taskFingerprints);
      const taskSequenceBefore = taskSequence;
      const eventSequenceBefore = eventSequence;
      try {
        return await operation();
      } catch (error) {
        tasks.splice(0, tasks.length, ...tasksBefore);
        events.splice(0, events.length, ...eventsBefore);
        eventFingerprints.clear();
        for (const [key, value] of eventFingerprintsBefore) eventFingerprints.set(key, value);
        taskFingerprints.clear();
        for (const [key, value] of taskFingerprintsBefore) taskFingerprints.set(key, value);
        taskSequence = taskSequenceBefore;
        eventSequence = eventSequenceBefore;
        throw error;
      }
    },
  };
}
