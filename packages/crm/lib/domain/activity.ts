export const ACTIVITY_EVENT_TYPES = [
  'contact-created',
  'contact-updated',
  'contact-imported',
  'note-added',
  'touch-recorded',
  'contact-archived',
  'contact-restored',
  'contact-point-added',
  'contact-point-updated',
  'contact-point-archived',
  'contact-point-restored',
  'household-updated',
  'relationship-updated',
  'assignment-updated',
  'custom-field-updated',
  'pipeline-stage-changed',
  'incomplete-record-received',
  'incomplete-record-converted',
  'email-metadata-linked',
  'email-sent',
  'task-created',
  'task-completed',
  'task-archived',
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export interface ActivityEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: ActivityEventType;
  readonly contactId?: string;
  readonly taskId?: string;
  readonly incompleteRecordId?: string;
  readonly actorMembershipId: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly idempotencyKey: string;
  /** Redacted, allowlisted facts needed to interpret this event. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export const TASK_STATUSES = ['open', 'completed', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskTransition = 'complete' | 'reopen' | 'archive';

export interface CrmTask {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId?: string;
  readonly title: string;
  readonly description?: string;
  readonly dueAt: string;
  readonly status: TaskStatus;
  /** Canonical optimistic-concurrency version persisted by Story 4.2. */
  readonly taskVersion?: number;
  readonly creatorMembershipId: string;
  readonly assigneeMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly completedByMembershipId?: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
}

export const TASK_TITLE_MAX = 160;
export const TASK_DESCRIPTION_MAX = 2_000;
export const TASK_BULK_MAX = 100;
export const ACTIVITY_SEARCH_MAX = 200;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class ActivityError extends Error {
  readonly code: 'invalid-input' | 'not-found' | 'conflict' | 'forbidden' | 'scope-mismatch';
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    code: ActivityError['code'],
    message: string,
    fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ActivityError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw new ActivityError('invalid-input', `${field} is invalid.`, {
      [field]: 'Use 1–128 letters, numbers, dashes, or underscores.',
    });
  }
  return value.trim();
}

function replayKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.trim())) {
    throw new ActivityError('invalid-input', 'idempotencyKey is invalid.', {
      idempotencyKey: 'Use 1–128 bounded replay-key characters.',
    });
  }
  return value.trim();
}

function printable(value: unknown, field: string, max: number, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') {
    throw new ActivityError('invalid-input', `${field} is required.`, { [field]: 'Enter text.' });
  }
  const clean = value.trim();
  if (!clean && optional) return undefined;
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ActivityError('invalid-input', `${field} is invalid.`, {
      [field]: `Use ${optional ? 'up to' : '1–'}${max} printable characters.`,
    });
  }
  return clean;
}

export function parseTaskTitle(value: unknown): string {
  return printable(value, 'title', TASK_TITLE_MAX) ?? '';
}

export function parseTaskDescription(value: unknown): string | undefined {
  return printable(value, 'description', TASK_DESCRIPTION_MAX, true);
}

export function parseInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ActivityError('invalid-input', `${field} is required.`, { [field]: 'Use an ISO date/time.' });
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ActivityError('invalid-input', `${field} is invalid.`, { [field]: 'Use an ISO date/time.' });
  }
  return date.toISOString();
}

export function parseOptionalIdentifier(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : identifier(value, field);
}

export function createActivityEvent(input: ActivityEvent): ActivityEvent {
  if (!ACTIVITY_EVENT_TYPES.includes(input.type)) {
    throw new ActivityError('invalid-input', 'Activity event type is invalid.', {
      type: 'Choose an allowlisted CRM event type.',
    });
  }
  const event: ActivityEvent = {
    id: identifier(input.id, 'id'),
    workspaceId: identifier(input.workspaceId, 'workspaceId'),
    type: input.type,
    ...(input.contactId ? { contactId: identifier(input.contactId, 'contactId') } : {}),
    ...(input.taskId ? { taskId: identifier(input.taskId, 'taskId') } : {}),
    ...(input.incompleteRecordId
      ? { incompleteRecordId: identifier(input.incompleteRecordId, 'incompleteRecordId') }
      : {}),
    actorMembershipId: identifier(input.actorMembershipId, 'actorMembershipId'),
    occurredAt: parseInstant(input.occurredAt, 'occurredAt'),
    createdAt: parseInstant(input.createdAt, 'createdAt'),
    idempotencyKey: replayKey(input.idempotencyKey),
    ...(input.metadata ? { metadata: Object.freeze({ ...input.metadata }) } : {}),
  };
  return Object.freeze(event);
}

export function validateBulkTaskIds(value: readonly unknown[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ActivityError('invalid-input', 'Choose at least one task.', {
      taskIds: 'Bulk commands require an explicit non-empty task ID list.',
    });
  }
  if (value.length > TASK_BULK_MAX) {
    throw new ActivityError('invalid-input', `Choose ${TASK_BULK_MAX} tasks or fewer.`, {
      taskIds: `Bulk commands accept at most ${TASK_BULK_MAX} task IDs.`,
    });
  }
  const taskIds = value.map((item) => identifier(item, 'taskIds'));
  if (new Set(taskIds).size !== taskIds.length) {
    throw new ActivityError('invalid-input', 'Task IDs must be unique.', {
      taskIds: 'Remove duplicate task IDs.',
    });
  }
  return taskIds;
}

export function completeTask(
  task: CrmTask,
  actorMembershipId: string,
  completedAt: string,
): { task: CrmTask; noOp: boolean } {
  if (task.status === 'completed') return { task, noOp: true };
  if (task.status === 'archived') {
    throw new ActivityError('conflict', 'Archived tasks cannot be completed.');
  }
  return {
    noOp: false,
    task: {
      ...task,
      status: 'completed',
      updatedAt: completedAt,
      completedAt,
      completedByMembershipId: actorMembershipId,
    },
  };
}

export function reopenTask(
  task: CrmTask,
  reopenedAt: string,
): { task: CrmTask; noOp: boolean } {
  if (task.status === 'open') return { task, noOp: true };
  if (task.status === 'archived') {
    throw new ActivityError('conflict', 'Archived tasks cannot be reopened.');
  }
  const reopened: Mutable<CrmTask> = { ...task, status: 'open', updatedAt: reopenedAt };
  delete reopened.completedAt;
  delete reopened.completedByMembershipId;
  return { task: reopened, noOp: false };
}

export function archiveTask(
  task: CrmTask,
  actorMembershipId: string,
  archivedAt: string,
): { task: CrmTask; noOp: boolean } {
  if (task.status === 'archived') return { task, noOp: true };
  return {
    noOp: false,
    task: {
      ...task,
      status: 'archived',
      updatedAt: archivedAt,
      archivedAt,
      archivedByMembershipId: actorMembershipId,
    },
  };
}

/** Open tasks sort overdue first, then due time, then creation time, with ID as the final stable tie. */
export function sortTasksForWorkQueue(tasks: readonly CrmTask[], now = new Date()): CrmTask[] {
  const instant = now.toISOString();
  const bucket = (task: CrmTask) => {
    if (task.status !== 'open') return 2;
    return task.dueAt < instant ? 0 : 1;
  };
  return [...tasks].sort((left, right) => (
    bucket(left) - bucket(right)
    || left.dueAt.localeCompare(right.dueAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
}
