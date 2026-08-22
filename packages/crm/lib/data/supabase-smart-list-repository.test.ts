import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SMART_LIST_SCHEMA_VERSION } from '@/lib/domain/smart-list';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseSmartListRepository } from './supabase-smart-list-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a',
  ownerUserId: 'user-a',
  membershipId: 'membership-a',
  workspaceId: 'workspace-a',
  role: 'owner',
  mode: 'live',
};

const definition = {
  schemaVersion: SMART_LIST_SCHEMA_VERSION,
  criteria: [{ field: 'leadType', operator: 'eq', value: 'hot' }] as const,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'list-a',
    workspace_id: 'workspace-a',
    name: 'Hot leads',
    definition,
    status: 'active',
    created_by_membership_id: 'membership-a',
    archived_at: null,
    archived_by_membership_id: null,
    archive_reason: null,
    created_at: '2026-08-11T12:00:00.000Z',
    updated_at: '2026-08-11T12:00:00.000Z',
    ...overrides,
  };
}

function smartListClient(initial = [row()]) {
  const rows = initial.map((item) => ({ ...item }));
  const calls: Array<{ operation: string; value?: unknown }> = [];
  function query() {
    const filters = new Map<string, unknown>();
    let insertValue: Record<string, unknown> | undefined;
    let updateValue: Record<string, unknown> | undefined;
    const matches = (item: Record<string, unknown>) => (
      [...filters].every(([field, value]) => item[field] === value)
    );
    const builder = {
      select(value?: unknown) { calls.push({ operation: 'select', value }); return this; },
      eq(field: string, value: unknown) {
        filters.set(field, value);
        calls.push({ operation: `eq:${field}`, value });
        return this;
      },
      order(field: string) { calls.push({ operation: `order:${field}` }); return this; },
      limit(value: number) {
        calls.push({ operation: 'limit', value });
        return Promise.resolve({ data: rows.filter(matches).slice(0, value), error: null });
      },
      insert(value: Record<string, unknown>) {
        insertValue = value;
        calls.push({ operation: 'insert', value });
        return this;
      },
      update(value: Record<string, unknown>) {
        updateValue = value;
        calls.push({ operation: 'update', value });
        return this;
      },
      maybeSingle() {
        const found = rows.find(matches);
        if (found && updateValue) Object.assign(found, updateValue);
        return Promise.resolve({ data: found ?? null, error: null });
      },
      single() {
        const created = row({ id: 'list-created', ...insertValue });
        rows.push(created);
        return Promise.resolve({ data: created, error: null });
      },
    };
    return builder;
  }
  return {
    client: { from() { return query(); } } as unknown as SupabaseClient,
    calls,
    rows,
  };
}

describe('supabaseSmartListRepository', () => {
  it('maps rows explicitly and bounds workspace-scoped list queries', async () => {
    const harness = smartListClient();
    const repository = supabaseSmartListRepository(harness.client);
    await expect(repository.list(scope)).resolves.toEqual([
      expect.objectContaining({
        id: 'list-a',
        workspaceId: 'workspace-a',
        createdByMembershipId: 'membership-a',
        definition,
      }),
    ]);
    expect(harness.calls).toContainEqual({ operation: 'eq:workspace_id', value: 'workspace-a' });
    expect(harness.calls).toContainEqual({ operation: 'limit', value: 500 });
  });

  it('persists actor/workspace authority and keeps archive/restore idempotent', async () => {
    const harness = smartListClient();
    const repository = supabaseSmartListRepository(harness.client);
    await repository.create(scope, {
      name: 'Hot leads',
      definition,
      createdByMembershipId: 'membership-a',
      createdAt: '2026-08-11T12:00:00.000Z',
    });
    expect(harness.calls.find((call) => call.operation === 'insert')?.value).toMatchObject({
      workspace_id: 'workspace-a',
      created_by_membership_id: 'membership-a',
    });

    const archived = await repository.archive(scope, 'list-a', {
      actorMembershipId: 'membership-a',
      archivedAt: '2026-08-11T13:00:00.000Z',
      reason: 'Not needed',
    });
    expect(archived).toMatchObject({ noOp: false, list: { status: 'archived' } });
    await expect(repository.archive(scope, 'list-a', {
      actorMembershipId: 'membership-a',
      archivedAt: '2026-08-11T14:00:00.000Z',
    })).resolves.toMatchObject({ noOp: true });
    await expect(repository.restore(scope, 'list-a', '2026-08-11T15:00:00.000Z'))
      .resolves.toMatchObject({ noOp: false, list: { status: 'active' } });
  });

  it('rejects a forged actor before persistence', async () => {
    const harness = smartListClient();
    await expect(supabaseSmartListRepository(harness.client).create(scope, {
      name: 'Hot leads',
      definition,
      createdByMembershipId: 'membership-b',
      createdAt: '2026-08-11T12:00:00.000Z',
    })).rejects.toThrow(/actor does not match/i);
    expect(harness.calls.some((call) => call.operation === 'insert')).toBe(false);
  });
});

