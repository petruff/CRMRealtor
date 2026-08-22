import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseWorkspaceRepository } from './supabase-workspace-repository';

interface Call {
  table?: string;
  operation: string;
  value?: unknown;
}

const ownerRow = {
  id: 'membership-owner-a',
  workspace_id: 'workspace-a',
  user_id: 'owner-a',
  role: 'owner',
  status: 'active',
  revoked_at: null,
  created_at: '2026-08-11T12:00:00.000Z',
  updated_at: '2026-08-11T12:00:00.000Z',
};

const assistantRow = {
  ...ownerRow,
  id: 'membership-assistant-a',
  user_id: 'assistant-a',
  role: 'assistant',
};

const ownerScope: WorkspaceScope = {
  authenticatedUserId: 'owner-a',
  ownerUserId: 'owner-a',
  membershipId: 'membership-owner-a',
  workspaceId: 'workspace-a',
  role: 'owner',
  mode: 'live',
};

function workspaceClient(options: {
  currentMembership?: typeof ownerRow | typeof assistantRow | null;
  activeOwner?: typeof ownerRow | null;
  rpcData?: unknown;
  rpcError?: { code?: string; message: string } | null;
  healthErrorTable?: string;
} = {}) {
  const calls: Call[] = [];
  const currentMembership = options.currentMembership === undefined
    ? ownerRow
    : options.currentMembership;
  const activeOwner = options.activeOwner === undefined ? ownerRow : options.activeOwner;
  function chain(table: string) {
    const filters = new Map<string, unknown>();
    return {
      select(value?: unknown) { calls.push({ table, operation: 'select', value }); return this; },
      eq(field: string, value: unknown) {
        filters.set(field, value);
        calls.push({ table, operation: `eq:${field}`, value });
        return this;
      },
      maybeSingle() {
        calls.push({ table, operation: 'maybeSingle' });
        if (table === 'workspace_members') {
          return Promise.resolve({
            data: filters.get('role') === 'owner' ? activeOwner : currentMembership,
            error: null,
          });
        }
        if (table === 'workspaces') {
          return Promise.resolve({
            data: {
              id: 'workspace-a',
              name: 'Omnix Workspace',
              created_at: '2026-08-11T12:00:00.000Z',
              updated_at: '2026-08-11T12:00:00.000Z',
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      order(field: string) {
        calls.push({ table, operation: `order:${field}` });
        if (table === 'workspace_members') {
          return Promise.resolve({ data: [ownerRow, assistantRow], error: null });
        }
        if (table === 'workspace_authority_audit_events') {
          return Promise.resolve({
            data: [
              {
                id: 'audit-a',
                workspace_id: 'workspace-a',
                actor_user_id: 'owner-a',
                action: 'member_added',
                result: 'succeeded',
                reason: null,
                correlation_id: '11111111-1111-4111-8111-111111111111',
                created_at: '2026-08-11T12:00:00.000Z',
              },
              {
                id: 'audit-b',
                workspace_id: 'workspace-a',
                actor_user_id: 'owner-a',
                action: 'member_reactivated',
                result: 'succeeded',
                reason: 'returning-assistant',
                correlation_id: '22222222-2222-4222-8222-222222222222',
                created_at: '2026-08-11T13:00:00.000Z',
              },
              {
                id: 'audit-c',
                workspace_id: 'workspace-a',
                actor_user_id: 'owner-a',
                action: 'workspace_renamed',
                result: 'failed',
                reason: null,
                correlation_id: '33333333-3333-4333-8333-333333333333',
                created_at: '2026-08-11T14:00:00.000Z',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
      limit(value: number) {
        calls.push({ table, operation: 'limit', value });
        return Promise.resolve({
          data: [],
          error: table === options.healthErrorTable
            ? { message: 'workspace scope unavailable' }
            : null,
        });
      },
    };
  }
  const client = {
    from(table: string) { calls.push({ table, operation: 'from' }); return chain(table); },
    rpc(name: string, args: unknown) {
      calls.push({ operation: `rpc:${name}`, value: args });
      return Promise.resolve({ data: options.rpcData ?? null, error: options.rpcError ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('supabaseWorkspaceRepository', () => {
  it('returns a durable snapshot only after verifying membership, owner and workspace', async () => {
    const { client } = workspaceClient();
    const repository = supabaseWorkspaceRepository(client);
    await expect(repository.show(ownerScope)).resolves.toMatchObject({
      durable: true,
      workspace: { id: 'workspace-a', name: 'Omnix Workspace' },
      currentMembership: { id: 'membership-owner-a', status: 'active' },
      scope: ownerScope,
    });
  });

  it('fails closed when a supplied scope does not match the active owner', async () => {
    const { client } = workspaceClient();
    const repository = supabaseWorkspaceRepository(client);
    await expect(repository.show({ ...ownerScope, ownerUserId: 'spoofed-owner' }))
      .rejects.toMatchObject({ code: 'scope-mismatch' });
  });

  it('allows only an owner to enumerate workspace memberships', async () => {
    const { client } = workspaceClient();
    const repository = supabaseWorkspaceRepository(client);
    await expect(repository.listMemberships(ownerScope)).resolves.toHaveLength(2);

    const assistantScope: WorkspaceScope = {
      ...ownerScope,
      authenticatedUserId: 'assistant-a',
      membershipId: 'membership-assistant-a',
      role: 'assistant',
    };
    const assistantClient = workspaceClient({ currentMembership: assistantRow }).client;
    await expect(supabaseWorkspaceRepository(assistantClient).listMemberships(assistantScope))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('accepts an audited administrator elevation without changing the stored assistant role', async () => {
    const administratorScope: WorkspaceScope = {
      ...ownerScope,
      authenticatedUserId: 'assistant-a',
      membershipId: 'membership-assistant-a',
      role: 'owner',
    };
    const granted = workspaceClient({ currentMembership: assistantRow, rpcData: true });
    await expect(supabaseWorkspaceRepository(granted.client).listMemberships(administratorScope))
      .resolves.toHaveLength(2);
    expect(granted.calls).toContainEqual({
      operation: 'rpc:is_workspace_owner',
      value: { target_workspace_id: 'workspace-a' },
    });

    const denied = workspaceClient({ currentMembership: assistantRow, rpcData: false });
    await expect(supabaseWorkspaceRepository(denied.client).listMemberships(administratorScope))
      .rejects.toMatchObject({ code: 'scope-mismatch' });
  });

  it('uses owner-only RPCs and preserves command correlation IDs', async () => {
    const added = {
      ...assistantRow,
      id: 'membership-assistant-b',
      user_id: 'assistant-b',
    };
    const addHarness = workspaceClient({ rpcData: [added] });
    const addedMembership = await supabaseWorkspaceRepository(addHarness.client).addMembership(
      ownerScope,
      {
        userId: 'assistant-b',
        role: 'assistant',
        correlationId: '11111111-1111-4111-8111-111111111111',
      },
    );
    expect(addedMembership).toMatchObject({ userId: 'assistant-b', status: 'active' });
    expect(addHarness.calls.find((call) => call.operation === 'rpc:add_workspace_assistant')?.value)
      .toEqual({
        target_user_id: 'assistant-b',
        target_correlation_id: '11111111-1111-4111-8111-111111111111',
        target_reason: null,
      });

    const revoked = {
      ...added,
      status: 'revoked',
      revoked_at: '2026-08-11T13:00:00.000Z',
      updated_at: '2026-08-11T13:00:00.000Z',
    };
    const revokeHarness = workspaceClient({ rpcData: revoked });
    await expect(supabaseWorkspaceRepository(revokeHarness.client).revokeMembership(
      ownerScope,
      {
        membershipId: 'membership-assistant-b',
        correlationId: '22222222-2222-4222-8222-222222222222',
      },
    )).resolves.toMatchObject({ status: 'revoked', revokedAt: revoked.revoked_at });
    expect(revokeHarness.calls.find((call) => call.operation === 'rpc:revoke_workspace_assistant'))
      .toBeDefined();
  });

  it('returns redacted live health and maps supported authority audit events', async () => {
    const { client, calls } = workspaceClient();
    const repository = supabaseWorkspaceRepository(client);
    const health = await repository.health(ownerScope);
    expect(health).toMatchObject({ mode: 'live', durable: true, status: 'healthy' });
    expect(JSON.stringify(health)).not.toMatch(/owner-a|assistant-a|token|secret|@/i);
    const queriedTables = new Set(calls
      .filter((call) => call.operation === 'from')
      .map((call) => call.table));
    expect([
        'contacts',
        'notes',
        'mailers',
        'mailer_sends',
        'contact_external_links',
        'contact_intake_receipts',
      ].every((table) => queriedTables.has(table))).toBe(true);
    expect(calls).toContainEqual({
      table: 'mailer_sends',
      operation: 'select',
      value: 'mailer_id',
    });
    await expect(repository.listAuthorityAuditEvents(ownerScope)).resolves.toEqual([
      expect.objectContaining({ action: 'membership.add' }),
      expect.objectContaining({
        action: 'membership.reactivate',
        reasonCode: 'returning-assistant',
      }),
      expect.objectContaining({ action: 'workspace.rename', result: 'failed' }),
    ]);
  });

  it('reports attention when any migrated workspace table is not queryable', async () => {
    const { client } = workspaceClient({ healthErrorTable: 'contact_intake_receipts' });
    await expect(supabaseWorkspaceRepository(client).health(ownerScope)).resolves.toMatchObject({
      status: 'attention-required',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'migration-backfill', status: 'fail' }),
      ]),
    });
  });
});
