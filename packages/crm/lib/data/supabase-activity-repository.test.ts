import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseActivityRepository } from './supabase-activity-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a',
  ownerUserId: 'user-a',
  membershipId: 'membership-a',
  workspaceId: 'workspace-a',
  role: 'owner',
  mode: 'live',
};

const taskRow = {
  id: 'task-a', workspace_id: 'workspace-a', contact_id: 'contact-a', title: 'Call Ada',
  description: null, due_at: '2026-08-12T12:00:00.000Z', status: 'open',
  task_version: 1,
  creator_membership_id: 'membership-a', assignee_membership_id: 'membership-a',
  completed_at: null, completed_by_membership_id: null, archived_at: null,
  archived_by_membership_id: null, created_at: '2026-08-11T12:00:00.000Z',
  updated_at: '2026-08-11T12:00:00.000Z',
};

const eventRow = {
  id: 'event-a', workspace_id: 'workspace-a', type: 'task-created', contact_id: 'contact-a',
  task_id: 'task-a', incomplete_record_id: null, actor_membership_id: 'membership-a',
  occurred_at: '2026-08-11T12:00:00.000Z', created_at: '2026-08-11T12:00:00.000Z',
  idempotency_key: 'task-create:create-a',
};

function activityClient() {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  function query(table: string) {
    const builder = {
      select(value?: unknown) { calls.push({ operation: `${table}:select`, value }); return this; },
      eq(field: string, value: unknown) { calls.push({ operation: `${table}:eq:${field}`, value }); return this; },
      gte(field: string, value: unknown) { calls.push({ operation: `${table}:gte:${field}`, value }); return this; },
      lte(field: string, value: unknown) { calls.push({ operation: `${table}:lte:${field}`, value }); return this; },
      order(field: string) { calls.push({ operation: `${table}:order:${field}` }); return this; },
      limit(value: number) {
        calls.push({ operation: `${table}:limit`, value });
        return Promise.resolve({ data: table === 'tasks' ? [taskRow] : [eventRow], error: null });
      },
      maybeSingle() { return Promise.resolve({ data: table === 'tasks' ? taskRow : null, error: null }); },
    };
    return builder;
  }
  const client = {
    from(table: string) { return query(table); },
    rpc(operation: string, value: unknown) {
      calls.push({ operation: `rpc:${operation}`, value });
      if (operation === 'append_activity_event') {
        return Promise.resolve({ data: { event: eventRow, noOp: false }, error: null });
      }
      if (operation === 'create_task_with_event') {
        return Promise.resolve({ data: { task: taskRow, event: eventRow, noOp: false }, error: null });
      }
      return Promise.resolve({
        data: { tasks: [{ ...taskRow, status: 'completed', completed_at: '2026-08-11T13:00:00.000Z', completed_by_membership_id: 'membership-a' }], events: [{ ...eventRow, type: 'task-completed', idempotency_key: 'task-complete:task-a:2026-08-11T13:00:00.000Z' }], noOpTaskIds: [] },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function aggregateClient(taskRows: readonly typeof taskRow[], eventRows: readonly typeof eventRow[]) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  function query(table: 'tasks' | 'activity_events') {
    const rows = table === 'tasks' ? taskRows : eventRows;
    let selected = [...rows];
    return {
      select(value?: unknown) { calls.push({ operation: `${table}:select`, value }); return this; },
      eq(field: string, value: unknown) {
        calls.push({ operation: `${table}:eq:${field}`, value });
        if (field === 'workspace_id') selected = selected.filter((row) => row.workspace_id === value);
        return this;
      },
      in(field: string, value: unknown) {
        calls.push({ operation: `${table}:in:${field}`, value });
        const allowed = new Set(value as readonly string[]);
        if (field === 'contact_id') selected = selected.filter((row) => row.contact_id && allowed.has(row.contact_id));
        return this;
      },
      order(field: string) { calls.push({ operation: `${table}:order:${field}` }); return this; },
      range(from: number, to: number) {
        calls.push({ operation: `${table}:range`, value: [from, to] });
        const providerEnd = Math.min(to + 1, from + 100);
        return Promise.resolve({ data: selected.slice(from, providerEnd), error: null, count: selected.length });
      },
    };
  }
  return {
    client: { from: (table: 'tasks' | 'activity_events') => query(table) } as unknown as SupabaseClient,
    calls,
  };
}

describe('supabaseActivityRepository', () => {
  it('maps and bounds workspace-scoped task and event reads', async () => {
    const harness = activityClient();
    const repository = supabaseActivityRepository(harness.client);
    await expect(repository.listTasks(scope, { status: 'open', limit: 25 }))
      .resolves.toEqual([expect.objectContaining({ id: 'task-a', workspaceId: 'workspace-a' })]);
    await expect(repository.listEvents(scope, { limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ id: 'event-a', type: 'task-created' })]);
    expect(harness.calls).toContainEqual({ operation: 'tasks:eq:workspace_id', value: 'workspace-a' });
    expect(harness.calls).toContainEqual({ operation: 'tasks:limit', value: 500 });
    expect(harness.calls).toContainEqual({ operation: 'activity_events:limit', value: 10 });
  });

  it('exhausts provider-capped rows for exact visible-contact aggregates beyond 1,000 records', async () => {
    const tasks = Array.from({ length: 1201 }, (_, index) => ({
      ...taskRow,
      id: `task-${index}`,
      contact_id: index % 3 === 0 ? 'donor-a' : 'contact-a',
      status: index % 2 === 0 ? 'open' : 'completed',
    }));
    const events = Array.from({ length: 1201 }, (_, index) => ({
      ...eventRow,
      id: `event-${index}`,
      contact_id: index % 3 === 0 ? 'donor-a' : 'contact-a',
      idempotency_key: `event-${index}`,
    }));
    const harness = aggregateClient(tasks, events);
    const identityMap = {
      async resolveCanonical(_scope: WorkspaceScope, contactId: string) { return contactId; },
      async listGroupMembers(_scope: WorkspaceScope, contactId: string) {
        return {
          requestedContactId: contactId,
          canonicalContactId: contactId,
          memberContactIds: [contactId, 'donor-a'],
          aliasEpoch: 1,
        };
      },
      async resolvePage(_scope: WorkspaceScope, contactIds: readonly string[]) {
        return new Map(contactIds.map((contactId) => [contactId, contactId]));
      },
    };

    await expect(supabaseActivityRepository(harness.client, identityMap).listContactAggregates!(
      scope,
      ['contact-a'],
    )).resolves.toEqual(new Map([['contact-a', {
      activityCount: 1201,
      openTaskCount: 601,
      completedTaskCount: 600,
    }]]));
    expect(harness.calls).toContainEqual({ operation: 'tasks:range', value: [1200, 1699] });
    expect(harness.calls).toContainEqual({ operation: 'activity_events:range', value: [1200, 1699] });
  });

  it.each([
    'incomplete-record-received',
    'email-metadata-linked',
    'email-sent',
  ])('accepts the persisted %s event introduced by connector migrations', async (type) => {
    const row = {
      ...eventRow,
      id: `event-${type}`,
      type,
      task_id: null,
      incomplete_record_id: type === 'incomplete-record-received' ? 'incomplete-a' : null,
      idempotency_key: `connector:${type}`,
    };
    const harness = activityClient();
    const client = {
      from() {
        const builder = {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          limit() { return Promise.resolve({ data: [row], error: null }); },
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    await expect(supabaseActivityRepository(client).listEvents(scope, { limit: 10 }))
      .resolves.toEqual([expect.objectContaining({ type })]);
    expect(harness.calls).toBeDefined();
  });

  it('uses atomic task and activity RPC envelopes with scoped actors', async () => {
    const harness = activityClient();
    const repository = supabaseActivityRepository(harness.client);
    await repository.createTask(scope, {
      contactId: 'contact-a', title: 'Call Ada', dueAt: '2026-08-12T12:00:00.000Z',
      creatorMembershipId: 'membership-a', assigneeMembershipId: 'membership-a',
      createdAt: '2026-08-11T12:00:00.000Z', idempotencyKey: 'create-a',
    });
    expect(harness.calls.find((call) => call.operation === 'rpc:create_task_with_event')?.value)
      .toMatchObject({
        target_workspace_id: 'workspace-a',
        target_creator_membership_id: 'membership-a',
        target_event_idempotency_key: 'task-create:create-a',
      });

    const completed = await repository.transitionTasks(scope, {
      taskIds: ['task-a'], transition: 'complete', actorMembershipId: 'membership-a',
      transitionedAt: '2026-08-11T13:00:00.000Z',
    });
    expect(completed).toMatchObject({ tasks: [{ status: 'completed' }], noOpTaskIds: [] });
    expect(harness.calls.find((call) => call.operation === 'rpc:transition_tasks_with_events')?.value)
      .toMatchObject({
        target_status: 'completed',
        target_event_commands: [{
          taskId: 'task-a', type: 'task-completed',
          idempotencyKey: 'task-complete:task-a:2026-08-11T13:00:00.000Z',
        }],
      });
  });

  it('rejects forged actors and unsupported bulk reopen before persistence', async () => {
    const harness = activityClient();
    const repository = supabaseActivityRepository(harness.client);
    await expect(repository.appendEvent(scope, {
      type: 'note-added', contactId: 'contact-a', actorMembershipId: 'membership-b',
      occurredAt: '2026-08-11T12:00:00.000Z', idempotencyKey: 'event-a',
    })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(repository.transitionTasks(scope, {
      taskIds: ['task-a', 'task-b'], transition: 'reopen', actorMembershipId: 'membership-a',
      transitionedAt: '2026-08-11T13:00:00.000Z',
    })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(harness.calls.some((call) => call.operation.startsWith('rpc:'))).toBe(false);
  });
});
