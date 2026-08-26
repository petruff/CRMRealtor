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
  supportGrantId?: string | null;
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
      if (name === 'resolve_workspace_support_grant_id') {
        return Promise.resolve({ data: options.supportGrantId ?? null, error: null });
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
      supportGrant: null,
    });
    expect(calls.some((call) => call.operation === 'rpc:resolve_workspace_support_grant_id')).toBe(true);
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
    const ownerB = { ...owner, id: 'membership-owner-b', workspace_id: 'workspace-b' };
    const { client, calls } = scopeClient({
      userMembershipResponses: [[owner, second]],
      ownerMemberships: [ownerB],
      supportGrantId: 'grant-owner-unused',
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'owner-a', {
      selectedWorkspaceId: 'workspace-b',
    })).resolves.toMatchObject({ workspaceId: 'workspace-b', membershipId: 'membership-owner-b' });
    expect(calls.some((call) => call.operation === 'rpc:bootstrap_personal_workspace')).toBe(false);
  });

  it('preserves the assistant role while resolving a separate support grant', async () => {
    const adminMembership = { ...owner, id: 'membership-admin-a', user_id: 'admin-a', role: 'assistant' as const };
    const { client } = scopeClient({
      userMembershipResponses: [[adminMembership]], ownerMemberships: [owner],
      supportGrantId: 'grant-support-a',
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'admin-a')).resolves.toMatchObject({
      authenticatedUserId: 'admin-a', ownerUserId: 'owner-a', role: 'assistant',
      supportGrant: { grantId: 'grant-support-a', active: true },
    });
  });

  it('keeps a revoked or absent support grant fail-closed', async () => {
    const adminMembership = { ...owner, id: 'membership-admin-a', user_id: 'admin-a', role: 'assistant' as const };
    const { client } = scopeClient({
      userMembershipResponses: [[adminMembership]], ownerMemberships: [owner], supportGrantId: null,
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'admin-a')).resolves.toMatchObject({
      role: 'assistant', supportGrant: null,
    });
  });

  it('binds support authority to the exact grant ID returned by the database', async () => {
    const adminMembership = { ...owner, id: 'membership-admin-a', user_id: 'admin-a', role: 'assistant' as const };
    const { client, calls } = scopeClient({
      userMembershipResponses: [[adminMembership]], ownerMemberships: [owner],
      supportGrantId: 'grant-audit-42',
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'admin-a')).resolves.toMatchObject({
      role: 'assistant', supportGrant: { grantId: 'grant-audit-42', active: true },
    });
    expect(calls).toContainEqual({
      operation: 'rpc:resolve_workspace_support_grant_id',
      value: { target_workspace_id: 'workspace-a' },
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

  it('rejects a bootstrap response that does not bind the authenticated canonical owner', async () => {
    const { client } = scopeClient({
      userMembershipResponses: [[]],
      rpcData: [{
        workspace_id: owner.workspace_id,
        membership_id: 'membership-assistant-a',
        owner_user_id: owner.user_id,
        role: 'assistant',
      }],
    });
    await expect(resolveSupabaseWorkspaceScope(client, 'assistant-a')).rejects.toThrow(
      /invalid canonical owner authority/i,
    );
  });
});
