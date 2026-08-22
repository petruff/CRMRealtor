import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAutomationRepositories, resolveAutomationWorkspaceScope } from './automation-context';

const OWNER_A = {
  id: 'membership-a',
  workspace_id: 'workspace-a',
  user_id: 'owner-a',
  role: 'owner' as const,
  status: 'active' as const,
};

const OWNER_B = {
  id: 'membership-b',
  workspace_id: 'workspace-b',
  user_id: 'owner-b',
  role: 'owner' as const,
  status: 'active' as const,
};

describe('automatic intake workspace binding', () => {
  it('uses the canonical workspace binding and returns an owner-backed live scope', () => {
    expect(resolveAutomationWorkspaceScope({ workspaceId: 'workspace-a' }, [OWNER_A])).toEqual({
      authenticatedUserId: 'owner-a',
      ownerUserId: 'owner-a',
      membershipId: 'membership-a',
      workspaceId: 'workspace-a',
      role: 'owner',
      mode: 'live',
    });
  });

  it('supports the temporary owner alias only when it resolves uniquely', () => {
    expect(resolveAutomationWorkspaceScope({ ownerId: 'owner-b' }, [OWNER_B])).toMatchObject({
      workspaceId: 'workspace-b',
      ownerUserId: 'owner-b',
    });
  });

  it('fails closed for contradictory, missing, or ambiguous bindings', () => {
    expect(() => resolveAutomationWorkspaceScope(
      { workspaceId: 'workspace-a', ownerId: 'owner-b' },
      [OWNER_A, OWNER_B],
    )).toThrow(/no unique active owner workspace/i);
    expect(() => resolveAutomationWorkspaceScope({ workspaceId: 'workspace-a' }, [])).toThrow(/no unique/i);
    expect(() => resolveAutomationWorkspaceScope({ ownerId: 'owner-a' }, [OWNER_A, { ...OWNER_A, id: 'duplicate' }]))
      .toThrow(/ambiguous/i);
  });

  it('exposes all Story 3.1 repositories under the resolved workspace context', () => {
    const workspaceScope = resolveAutomationWorkspaceScope({ workspaceId: 'workspace-a' }, [OWNER_A]);
    const repositories = createAutomationRepositories({} as SupabaseClient, workspaceScope);
    expect(repositories).toEqual(expect.objectContaining({
      repository: expect.any(Object),
      importGateway: expect.any(Object),
      smartListRepository: expect.any(Object),
      incompleteRecordRepository: expect.any(Object),
      activityRepository: expect.any(Object),
    }));
  });
});
