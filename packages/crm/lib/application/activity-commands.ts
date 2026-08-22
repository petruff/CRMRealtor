import type {
  ActivityRepository,
  AppendActivityEventInput,
  TaskQuery,
} from '../data/activity-repository.ts';
import {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_SEARCH_MAX,
  ActivityError,
  parseInstant,
  parseOptionalIdentifier,
  parseTaskDescription,
  parseTaskTitle,
  TASK_STATUSES,
  validateBulkTaskIds,
  type ActivityEvent,
  type ActivityEventType,
  type CrmTask,
  type TaskStatus,
  type TaskTransition,
} from '../domain/activity.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';

export const ACTIVITY_LIST_MAX = 500;

function positiveLimit(value: unknown): number {
  const limit = value === undefined ? 100 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_LIST_MAX) {
    throw new ActivityError('invalid-input', `limit must be 1–${ACTIVITY_LIST_MAX}.`);
  }
  return limit;
}

function search(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length > ACTIVITY_SEARCH_MAX) {
    throw new ActivityError('invalid-input', `Search must be ${ACTIVITY_SEARCH_MAX} characters or fewer.`);
  }
  return value.trim() || undefined;
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.trim())) {
    throw new ActivityError('invalid-input', 'idempotencyKey is invalid.');
  }
  return value.trim();
}

function timestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new ActivityError('invalid-input', 'Timestamp is invalid.');
  return now.toISOString();
}

export async function listTasksCommand(
  repository: ActivityRepository,
  untrustedScope: WorkspaceScope,
  input: {
    query?: unknown;
    contactId?: unknown;
    assigneeMembershipId?: unknown;
    status?: unknown;
    dueFrom?: unknown;
    dueTo?: unknown;
    limit?: unknown;
  } = {},
): Promise<readonly CrmTask[]> {
  const status = input.status ?? 'open';
  if (status !== 'all' && !TASK_STATUSES.includes(status as TaskStatus)) {
    throw new ActivityError('invalid-input', 'Task status is invalid.');
  }
  const dueFrom = input.dueFrom === undefined ? undefined : parseInstant(input.dueFrom, 'dueFrom');
  const dueTo = input.dueTo === undefined ? undefined : parseInstant(input.dueTo, 'dueTo');
  if (dueFrom && dueTo && dueFrom > dueTo) {
    throw new ActivityError('invalid-input', 'dueFrom must not be after dueTo.');
  }
  const query: TaskQuery = {
    ...(search(input.query) ? { query: search(input.query) } : {}),
    ...(parseOptionalIdentifier(input.contactId, 'contactId') ? {
      contactId: parseOptionalIdentifier(input.contactId, 'contactId'),
    } : {}),
    ...(parseOptionalIdentifier(input.assigneeMembershipId, 'assigneeMembershipId') ? {
      assigneeMembershipId: parseOptionalIdentifier(input.assigneeMembershipId, 'assigneeMembershipId'),
    } : {}),
    status: status as TaskStatus | 'all',
    ...(dueFrom ? { dueFrom } : {}),
    ...(dueTo ? { dueTo } : {}),
    limit: positiveLimit(input.limit),
  };
  return repository.listTasks(validateWorkspaceScope(untrustedScope), query);
}

export async function listActivityEventsCommand(
  repository: ActivityRepository,
  untrustedScope: WorkspaceScope,
  input: {
    contactId?: unknown;
    taskId?: unknown;
    type?: unknown;
    from?: unknown;
    to?: unknown;
    limit?: unknown;
  } = {},
): Promise<readonly ActivityEvent[]> {
  if (input.type !== undefined && !ACTIVITY_EVENT_TYPES.includes(input.type as ActivityEventType)) {
    throw new ActivityError('invalid-input', 'Activity event type is invalid.');
  }
  const from = input.from === undefined ? undefined : parseInstant(input.from, 'from');
  const to = input.to === undefined ? undefined : parseInstant(input.to, 'to');
  if (from && to && from > to) throw new ActivityError('invalid-input', 'from must not be after to.');
  return repository.listEvents(validateWorkspaceScope(untrustedScope), {
    ...(parseOptionalIdentifier(input.contactId, 'contactId') ? {
      contactId: parseOptionalIdentifier(input.contactId, 'contactId'),
    } : {}),
    ...(parseOptionalIdentifier(input.taskId, 'taskId') ? {
      taskId: parseOptionalIdentifier(input.taskId, 'taskId'),
    } : {}),
    ...(input.type ? { type: input.type as ActivityEventType } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: positiveLimit(input.limit),
  });
}

export async function appendActivityEventCommand(
  repository: ActivityRepository,
  untrustedScope: WorkspaceScope,
  input: Omit<AppendActivityEventInput, 'actorMembershipId' | 'occurredAt'> & {
    occurredAt?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(untrustedScope);
  if (!ACTIVITY_EVENT_TYPES.includes(input.type)) {
    throw new ActivityError('invalid-input', 'Activity event type is invalid.');
  }
  const contactId = parseOptionalIdentifier(input.contactId, 'contactId');
  const taskId = parseOptionalIdentifier(input.taskId, 'taskId');
  const incompleteRecordId = parseOptionalIdentifier(input.incompleteRecordId, 'incompleteRecordId');
  return repository.appendEvent(scope, {
    type: input.type,
    ...(contactId ? { contactId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(incompleteRecordId ? { incompleteRecordId } : {}),
    actorMembershipId: scope.membershipId,
    occurredAt: input.occurredAt === undefined ? timestamp(now) : parseInstant(input.occurredAt, 'occurredAt'),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  });
}

export async function createTaskCommand(
  repository: ActivityRepository,
  untrustedScope: WorkspaceScope,
  input: {
    contactId?: unknown;
    title?: unknown;
    description?: unknown;
    dueAt?: unknown;
    assigneeMembershipId?: unknown;
    idempotencyKey?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(untrustedScope);
  return repository.createTask(scope, {
    ...(parseOptionalIdentifier(input.contactId, 'contactId') ? {
      contactId: parseOptionalIdentifier(input.contactId, 'contactId'),
    } : {}),
    title: parseTaskTitle(input.title),
    ...(parseTaskDescription(input.description) ? { description: parseTaskDescription(input.description) } : {}),
    dueAt: parseInstant(input.dueAt, 'dueAt'),
    creatorMembershipId: scope.membershipId,
    assigneeMembershipId: parseOptionalIdentifier(input.assigneeMembershipId, 'assigneeMembershipId')
      ?? scope.membershipId,
    createdAt: timestamp(now),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  });
}

export async function transitionTasksCommand(
  repository: ActivityRepository,
  untrustedScope: WorkspaceScope,
  taskIds: readonly unknown[],
  transition: TaskTransition,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(untrustedScope);
  return repository.transitionTasks(scope, {
    taskIds: validateBulkTaskIds(taskIds),
    transition,
    actorMembershipId: scope.membershipId,
    transitionedAt: timestamp(now),
  });
}

export async function completeTaskCommand(
  repository: ActivityRepository,
  scope: WorkspaceScope,
  taskId: unknown,
  now = new Date(),
) {
  return transitionTasksCommand(repository, scope, [taskId], 'complete', now);
}

export async function reopenTaskCommand(
  repository: ActivityRepository,
  scope: WorkspaceScope,
  taskId: unknown,
  now = new Date(),
) {
  return transitionTasksCommand(repository, scope, [taskId], 'reopen', now);
}

export async function archiveTaskCommand(
  repository: ActivityRepository,
  scope: WorkspaceScope,
  taskId: unknown,
  now = new Date(),
) {
  return transitionTasksCommand(repository, scope, [taskId], 'archive', now);
}
