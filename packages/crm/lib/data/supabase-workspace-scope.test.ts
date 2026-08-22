import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSupabaseWorkspaceScope } from './supabase-workspace-scope';

interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'assistant';
  status: 'active';
}

function scopeClient(options: {
  userMembershipResponses: MembershipRow[][];
  ownerMemberships?: MembershipRow[];
  rpcError?: { message: string } | null;
  rpcData?: unknown;
  privileged?: boolean;
}) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  let userQuery = 0;
  const client = {
    from(table: string) {
      calls.push({ operation: 'from', value: table });
      const filters = new Map<string, unknown>();
      return {
        select(value: string) {
          calls.push({ operation: 'select', value });
          return this;
        },
        eq(field: string, value: unknown) {
          filters.set(field, value);
          calls.push({ operation: `eq:${field}`, value });
          return this;
        },
        limit(value: number) {
          calls.push({ operation: 'limit', value });
          if (filters.get('role') === 'owner') {
            return Promise.resolve({ data: options.ownerMemberships ?? [], error: null });
          }
          const data = options.userMembershipResponses[userQuery] ?? [];
          userQuery += 1;
          return Promise.resolve({ data, error: null });
        },
      };
    },
    rpc(name: string, args: unknown) {
      calls.push({ operation: `rpc:${name}`, value: args });
      if (name === 'is_workspace_owner') {
        return Promise.resolve({ data: options.privileged ?? false, error: null });
      }
      return Promise.resolve({ data: options.rpcData ?? null, error: options.rpcError ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const owner = {
  id: 'membership-owner-a',
  workspace_id: 'workspace-a',
  user_id: 'owner-a',
  role: 'owner' as const,
  status: 'active' as const,
};

describe('resolveSupabaseWorkspaceScope', () => {
  it('resolves an active assistant membership and the workspace active owner', async () => {
    const assistant = {
      ...owner,
      id: 'membership-assistant-a',
      user_id: 'assistant-a',
      role: 'assistant' as const,
    };
    const { client, calls } = scopeClient({
      userMembershipResponses: [[assistant]],
      ownerMemberships: [owner],
    });

    await expect(resolveSupabaseWorkspaceScope(client, 'assistant-a')).resolves.toEqual({
      authenticatedUserId: 'assistant-a',
      ownerUserId: 'owner-a',
      membershipId: 'membership-assistant-a',
      workspaceId: 'workspace-a',
      role: 'assistant',
      mode: 'live',
    });
    expect(calls.some((call) => call.operation === 'rpc:is_workspace_owner')).toBe(true);
  });

  it('bootstraps only when there is no active membership and then re-resolves authority', async () => {
    const { client, calls } = scopeClient({
      userMembershipResponses: [[]],
      ownerMemberships: [owner],
      rpcData: [{
        workspace_id: owner.workspace_id,
        membership_id: owner.id,
        owner_user_id: owner.user_id,
        role: owner.role,
      }],
    });

    await expect(resolveSupabaseWorkspaceScope(client, 'owner-a', {
      bootstrapWorkspaceName: 'Omnix Personal',
    })).resolves.toMatchObject({ workspaceId: 'workspace-a', role: 'owner' });
    expect(calls.filter((call) => call.operation === 'rpc:bootstrap_personal_workspace')).toEqual([
      {
        operation: 'rpc:bootstrap_personal_workspace',
        value: { workspace_name: 'Omnix Personal' },
      },
    ]);
  });

  it('selects an explicit workspace when multiple memberships are active', async () => {
    const second = { ...owner, id: 'membership-owner-b', workspace_id: 'workspace-b' };
    const ownerB = { ...owner, id: 'membership-owner-b2', workspace_id: 'workspace-b' };
    const { client, calls } = scopeClient({
      userMembershipResponses: [[owner, second]],
      ownerMemberships: [ownerB],
      privileged: true,
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'owner-a', {
      selectedWorkspaceId: 'workspace-b',
    })).resolves.toMatchObject({ workspaceId: 'workspace-b', membershipId: 'membership-owner-b' });
    expect(calls.some((call) => call.operation === 'rpc:bootstrap_personal_workspace')).toBe(false);
  });

  it('elevates an audited administrator grant without changing the owner identity', async () => {
    const adminMembership = { ...owner, id: 'membership-admin-a', user_id: 'admin-a', role: 'assistant' as const };
    const { client } = scopeClient({
      userMembershipResponses: [[adminMembership]], ownerMemberships: [owner], privileged: true,
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'admin-a')).resolves.toMatchObject({
      authenticatedUserId: 'admin-a', ownerUserId: 'owner-a', role: 'owner',
    });
  });

  it('fails closed when the workspace has no unique active owner', async () => {
    const { client } = scopeClient({
      userMembershipResponses: [[owner]],
      ownerMemberships: [],
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'owner-a')).rejects.toThrow(
      /exactly one active owner/i,
    );
  });

  it('does not accept a bootstrap that remains unresolved', async () => {
    const { client } = scopeClient({ userMembershipResponses: [[], []] });
    await expect(resolveSupabaseWorkspaceScope(client, 'owner-a')).rejects.toThrow(
      /returned no active membership/i,
    );
  });
});
