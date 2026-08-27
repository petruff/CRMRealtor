import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTIVITY_EVENT_TYPES,
  ActivityError,
  createActivityEvent,
  parseInstant,
  parseOptionalIdentifier,
  parseTaskDescription,
  parseTaskTitle,
  sortTasksForWorkQueue,
  TASK_STATUSES,
  validateBulkTaskIds,
  type ActivityEvent,
  type CrmTask,
  type TaskStatus,
} from '../domain/activity.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type {
  ActivityRepository,
  CreateTaskRecordResult,
  TransitionTasksResult,
} from './activity-repository.ts';
import type { ContactIdentityMap } from './contact-identity-map.ts';

export interface ActivityEventRow {
  id: string;
  workspace_id: string;
  type: string;
  contact_id: string | null;
  task_id: string | null;
  incomplete_record_id: string | null;
  actor_membership_id: string;
  occurred_at: string;
  created_at: string;
  idempotency_key: string;
  metadata: Record<string, string | number | boolean | null> | null;
}

interface TaskRow {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  title: string;
  description: string | null;
  due_at: string;
  status: string;
  task_version: number;
  creator_membership_id: string;
  assignee_membership_id: string;
  completed_at: string | null;
  completed_by_membership_id: string | null;
  archived_at: string | null;
  archived_by_membership_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AppendEventEnvelope {
  event: unknown;
  noOp: unknown;
}

interface CreateTaskEnvelope extends AppendEventEnvelope {
  task: unknown;
}

interface TransitionTasksEnvelope {
  tasks: unknown;
  events: unknown;
  noOpTaskIds: unknown;
}

const EVENT_COLUMNS = [
  'id', 'workspace_id', 'type', 'contact_id', 'task_id', 'incomplete_record_id',
  'actor_membership_id', 'occurred_at', 'created_at', 'idempotency_key',
  'metadata',
].join(', ');
const TASK_COLUMNS = [
  'id', 'workspace_id', 'contact_id', 'title', 'description', 'due_at', 'status',
  'task_version',
  'creator_membership_id', 'assignee_membership_id', 'completed_at',
  'completed_by_membership_id', 'archived_at', 'archived_by_membership_id',
  'created_at', 'updated_at',
].join(', ');
const LIVE_LIST_MAX = 500;
const SEARCH_MAX = 200;
const CONTACT_AGGREGATE_MAX_CONTACTS = 50;
const CONTACT_AGGREGATE_ID_BATCH = 100;

function liveScope(untrustedScope: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') {
    throw new ActivityError('scope-mismatch', 'Supabase activity requires live mode.');
  }
  return scope;
}

function persistenceError(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new ActivityError('forbidden', message);
  if (error.code === '23505') return new ActivityError('conflict', message);
  if (error.code === '23514') return new ActivityError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > LIVE_LIST_MAX) {
    throw new ActivityError('invalid-input', 'Activity list limit must be 1–500.');
  }
  return value;
}

export function activityEventFromRow(row: ActivityEventRow): ActivityEvent {
  if (!ACTIVITY_EVENT_TYPES.includes(row.type as ActivityEvent['type'])) {
    throw new ActivityError('conflict', 'Persistence returned an invalid activity event type.');
  }
  return createActivityEvent({
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as ActivityEvent['type'],
    ...(row.contact_id ? { contactId: row.contact_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.incomplete_record_id ? { incompleteRecordId: row.incomplete_record_id } : {}),
    actorMembershipId: row.actor_membership_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    idempotencyKey: row.idempotency_key,
    ...(row.metadata && Object.keys(row.metadata).length ? { metadata: row.metadata } : {}),
  });
}

function toTask(row: TaskRow): CrmTask {
  if (!TASK_STATUSES.includes(row.status as TaskStatus)) {
    throw new ActivityError('conflict', 'Persistence returned an invalid task status.');
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ...(row.contact_id ? { contactId: row.contact_id } : {}),
    title: parseTaskTitle(row.title),
    ...(row.description ? { description: parseTaskDescription(row.description) } : {}),
    dueAt: parseInstant(row.due_at, 'dueAt'),
    status: row.status as TaskStatus,
    taskVersion: row.task_version,
    creatorMembershipId: row.creator_membership_id,
    assigneeMembershipId: row.assignee_membership_id,
    createdAt: parseInstant(row.created_at, 'createdAt'),
    updatedAt: parseInstant(row.updated_at, 'updatedAt'),
    ...(row.completed_at ? { completedAt: parseInstant(row.completed_at, 'completedAt') } : {}),
    ...(row.completed_by_membership_id
      ? { completedByMembershipId: row.completed_by_membership_id }
      : {}),
    ...(row.archived_at ? { archivedAt: parseInstant(row.archived_at, 'archivedAt') } : {}),
    ...(row.archived_by_membership_id
      ? { archivedByMembershipId: row.archived_by_membership_id }
      : {}),
  };
}

function objectEnvelope(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActivityError('conflict', message);
  }
  return value as Record<string, unknown>;
}

function appendReceipt(value: unknown): { event: ActivityEvent; noOp: boolean } {
  const envelope = objectEnvelope(value, 'Activity append returned an invalid receipt.') as unknown as AppendEventEnvelope;
  if (
    typeof envelope.noOp !== 'boolean'
    || !envelope.event
    || typeof envelope.event !== 'object'
    || Array.isArray(envelope.event)
  ) {
    throw new ActivityError('conflict', 'Activity append returned an invalid receipt.');
  }
  return { event: activityEventFromRow(envelope.event as ActivityEventRow), noOp: envelope.noOp };
}

function createTaskReceipt(value: unknown): CreateTaskRecordResult {
  const envelope = objectEnvelope(value, 'Task create returned an invalid receipt.') as unknown as CreateTaskEnvelope;
  if (
    typeof envelope.noOp !== 'boolean'
    || !envelope.task || typeof envelope.task !== 'object' || Array.isArray(envelope.task)
    || !envelope.event || typeof envelope.event !== 'object' || Array.isArray(envelope.event)
  ) {
    throw new ActivityError('conflict', 'Task create returned an invalid receipt.');
  }
  return {
    task: toTask(envelope.task as TaskRow),
    event: activityEventFromRow(envelope.event as ActivityEventRow),
    noOp: envelope.noOp,
  };
}

function transitionReceipt(value: unknown): TransitionTasksResult {
  const envelope = objectEnvelope(value, 'Task transition returned an invalid receipt.') as unknown as TransitionTasksEnvelope;
  if (
    !Array.isArray(envelope.tasks)
    || !Array.isArray(envelope.events)
    || !Array.isArray(envelope.noOpTaskIds)
    || !envelope.noOpTaskIds.every((id) => typeof id === 'string')
  ) {
    throw new ActivityError('conflict', 'Task transition returned an invalid receipt.');
  }
  return {
    tasks: envelope.tasks.map((row) => toTask(row as TaskRow)),
    events: envelope.events.map((row) => activityEventFromRow(row as ActivityEventRow)),
    noOpTaskIds: envelope.noOpTaskIds as string[],
  };
}

export function supabaseActivityRepository(
  supabase: SupabaseClient,
  identityMap?: ContactIdentityMap,
): ActivityRepository {
  async function canonicalEvents(scope: WorkspaceScope, events: readonly ActivityEvent[]) {
    if (!identityMap) return events;
    const ids = events.flatMap((event) => event.contactId ? [event.contactId] : []);
    const aliases = await identityMap.resolvePage(scope, ids);
    return events.map((event) => event.contactId
      ? { ...event, contactId: aliases.get(event.contactId) ?? event.contactId }
      : event);
  }

  async function canonicalTasks(scope: WorkspaceScope, tasks: readonly CrmTask[]) {
    if (!identityMap) return tasks;
    const ids = tasks.flatMap((task) => task.contactId ? [task.contactId] : []);
    const aliases = await identityMap.resolvePage(scope, ids);
    return tasks.map((task) => task.contactId
      ? { ...task, contactId: aliases.get(task.contactId) ?? task.contactId }
      : task);
  }

  async function aggregateRows(
    scope: WorkspaceScope,
    table: 'tasks' | 'activity_events',
    columns: string,
    contactIds: readonly string[],
  ): Promise<readonly Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let batchStart = 0; batchStart < contactIds.length; batchStart += CONTACT_AGGREGATE_ID_BATCH) {
      const batch = contactIds.slice(batchStart, batchStart + CONTACT_AGGREGATE_ID_BATCH);
      let offset = 0;
      let exactCount: number | undefined;
      const seenIds = new Set<string>();
      while (exactCount === undefined || offset < exactCount) {
        const { data, error, count } = await supabase
          .from(table)
          .select(columns, { count: 'exact' })
          .eq('workspace_id', scope.workspaceId)
          .in('contact_id', [...batch])
          .order('id', { ascending: true })
          .range(offset, offset + LIVE_LIST_MAX - 1);
        if (error) throw persistenceError('Failed to count contact activity', error);
        if (typeof count !== 'number') {
          throw new ActivityError('conflict', 'Contact activity count was not exact.');
        }
        if (exactCount !== undefined && count !== exactCount) {
          throw new ActivityError('conflict', 'Contact activity changed while counts were loading.');
        }
        exactCount = count;
        const page = (data ?? []) as unknown as Record<string, unknown>[];
        if (!page.length && offset < exactCount) {
          throw new ActivityError('conflict', 'Contact activity ended before its exact count.');
        }
        for (const row of page) {
          const id = row.id;
          if (typeof id !== 'string' || seenIds.has(id)) {
            throw new ActivityError('conflict', 'Contact activity pagination returned duplicate rows.');
          }
          seenIds.add(id);
          rows.push(row);
        }
        offset += page.length;
      }
    }
    return rows;
  }

  return {
    async listEvents(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      const limit = boundedLimit(query.limit);
      let builder = supabase
        .from('activity_events')
        .select(EVENT_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (query.contactId) {
        const group = identityMap
          ? await identityMap.listGroupMembers(scope, query.contactId)
          : undefined;
        builder = group
          ? builder.in('contact_id', [...group.memberContactIds])
          : builder.eq('contact_id', query.contactId);
      }
      if (query.taskId) builder = builder.eq('task_id', query.taskId);
      if (query.type) builder = builder.eq('type', query.type);
      if (query.from) builder = builder.gte('occurred_at', query.from);
      if (query.to) builder = builder.lte('occurred_at', query.to);
      const { data, error } = await builder
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw persistenceError('Failed to list activity events', error);
      return canonicalEvents(scope, ((data ?? []) as unknown as ActivityEventRow[]).map(activityEventFromRow));
    },

    async listContactAggregates(untrustedScope, contactIds) {
      const scope = liveScope(untrustedScope);
      const targets = [...new Set(contactIds.map((contactId) => (
        parseOptionalIdentifier(contactId, 'contactId')
      )).filter((contactId): contactId is string => Boolean(contactId)))];
      if (targets.length > CONTACT_AGGREGATE_MAX_CONTACTS) {
        throw new ActivityError('invalid-input', 'Contact activity counts support at most 50 visible contacts.');
      }
      const aggregates = new Map(targets.map((contactId) => [contactId, {
        activityCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
      }]));
      if (!targets.length) return aggregates;

      const memberToTarget = new Map<string, string>();
      if (identityMap) {
        const groups = await Promise.all(targets.map(async (target) => ({
          target,
          group: await identityMap.listGroupMembers(scope, target),
        })));
        for (const { target, group } of groups) {
          for (const memberId of group.memberContactIds) {
            const existing = memberToTarget.get(memberId);
            if (existing && existing !== target) {
              throw new ActivityError('conflict', 'Contact identity groups overlap.');
            }
            memberToTarget.set(memberId, target);
          }
        }
      } else {
        for (const target of targets) memberToTarget.set(target, target);
      }

      const memberIds = [...memberToTarget.keys()];
      const [taskRows, eventRows] = await Promise.all([
        aggregateRows(scope, 'tasks', 'id, contact_id, status', memberIds),
        aggregateRows(scope, 'activity_events', 'id, contact_id', memberIds),
      ]);
      for (const row of eventRows) {
        const target = typeof row.contact_id === 'string' ? memberToTarget.get(row.contact_id) : undefined;
        const aggregate = target ? aggregates.get(target) : undefined;
        if (aggregate) aggregate.activityCount += 1;
      }
      for (const row of taskRows) {
        const target = typeof row.contact_id === 'string' ? memberToTarget.get(row.contact_id) : undefined;
        const aggregate = target ? aggregates.get(target) : undefined;
        if (!aggregate) continue;
        if (row.status === 'open') aggregate.openTaskCount += 1;
        if (row.status === 'completed') aggregate.completedTaskCount += 1;
      }
      return aggregates;
    },

    async appendEvent(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (input.actorMembershipId !== scope.membershipId) {
        throw new ActivityError('forbidden', 'Actor does not match workspace membership.');
      }
      if (input.metadata && Object.keys(input.metadata).length) {
        throw new ActivityError('invalid-input', 'Metadata events require a specialized atomic command.');
      }
      const canonicalContactId = input.contactId && identityMap
        ? await identityMap.resolveCanonical(scope, input.contactId)
        : input.contactId;
      const { data, error } = await supabase.rpc('append_activity_event', {
        target_workspace_id: scope.workspaceId,
        target_type: input.type,
        target_actor_membership_id: scope.membershipId,
        target_occurred_at: input.occurredAt,
        target_idempotency_key: input.idempotencyKey,
        target_contact_id: canonicalContactId ?? null,
        target_task_id: input.taskId ?? null,
        target_incomplete_record_id: input.incompleteRecordId ?? null,
      });
      if (error) throw persistenceError('Failed to append activity event', error);
      return appendReceipt(data);
    },

    async listTasks(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      const limit = boundedLimit(query.limit);
      const needle = query.query?.trim().toLowerCase();
      if (needle && needle.length > SEARCH_MAX) {
        throw new ActivityError('invalid-input', 'Task search is too long.');
      }
      let builder = supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (query.status && query.status !== 'all') builder = builder.eq('status', query.status);
      if (query.contactId) {
        const group = identityMap
          ? await identityMap.listGroupMembers(scope, query.contactId)
          : undefined;
        builder = group
          ? builder.in('contact_id', [...group.memberContactIds])
          : builder.eq('contact_id', query.contactId);
      }
      if (query.assigneeMembershipId) {
        builder = builder.eq('assignee_membership_id', query.assigneeMembershipId);
      }
      if (query.dueFrom) builder = builder.gte('due_at', query.dueFrom);
      if (query.dueTo) builder = builder.lte('due_at', query.dueTo);
      const { data, error } = await builder
        .order('due_at', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(LIVE_LIST_MAX);
      if (error) throw persistenceError('Failed to list tasks', error);
      const selected = ((data ?? []) as unknown as TaskRow[])
        .map(toTask)
        .filter((task) => !needle || `${task.title} ${task.description ?? ''}`.toLowerCase().includes(needle));
      return canonicalTasks(scope, sortTasksForWorkQueue(selected).slice(0, limit));
    },

    async getTask(untrustedScope, id) {
      const scope = liveScope(untrustedScope);
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('workspace_id', scope.workspaceId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw persistenceError('Failed to load task', error);
      if (!data) return undefined;
      const [task] = await canonicalTasks(scope, [toTask(data as unknown as TaskRow)]);
      return task;
    },

    async createTask(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (input.creatorMembershipId !== scope.membershipId) {
        throw new ActivityError('forbidden', 'Creator does not match workspace membership.');
      }
      const canonicalContactId = input.contactId && identityMap
        ? await identityMap.resolveCanonical(scope, input.contactId)
        : input.contactId;
      const { data, error } = await supabase.rpc('create_task_with_event', {
        target_workspace_id: scope.workspaceId,
        target_contact_id: canonicalContactId ?? null,
        target_title: input.title,
        target_description: input.description ?? null,
        target_due_at: input.dueAt,
        target_creator_membership_id: scope.membershipId,
        target_assignee_membership_id: input.assigneeMembershipId,
        target_task_idempotency_key: input.idempotencyKey,
        target_event_idempotency_key: `task-create:${input.idempotencyKey}`,
        target_created_at: input.createdAt,
      });
      if (error) throw persistenceError('Failed to create task', error);
      return createTaskReceipt(data);
    },

    async transitionTasks(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (input.actorMembershipId !== scope.membershipId) {
        throw new ActivityError('forbidden', 'Actor does not match workspace membership.');
      }
      const taskIds = validateBulkTaskIds(input.taskIds);
      if (input.transition === 'reopen' && taskIds.length !== 1) {
        throw new ActivityError('invalid-input', 'Bulk reopen is not supported.');
      }
      const status: TaskStatus = input.transition === 'complete'
        ? 'completed'
        : input.transition === 'archive' ? 'archived' : 'open';
      const eventType = input.transition === 'complete' ? 'task-completed' : 'task-archived';
      const eventCommands = input.transition === 'reopen' ? [] : taskIds.map((taskId) => ({
        taskId,
        type: eventType,
        idempotencyKey: `task-${input.transition}:${taskId}:${input.transitionedAt}`,
      }));
      const { data, error } = await supabase.rpc('transition_tasks_with_events', {
        target_workspace_id: scope.workspaceId,
        target_task_ids: [...taskIds],
        target_status: status,
        target_actor_membership_id: scope.membershipId,
        target_transitioned_at: input.transitionedAt,
        target_event_commands: eventCommands,
      });
      if (error) throw persistenceError('Failed to transition tasks', error);
      return transitionReceipt(data);
    },
  };
}
