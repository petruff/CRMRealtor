import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSupabaseServerClient } = vi.hoisted(() => ({ createSupabaseServerClient: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient }));

import { listAvailableWorkspaceMemberships } from './workspace-memberships';

describe('workspace page membership loading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the explicit sample workspace independent from Supabase', async () => {
    await expect(listAvailableWorkspaceMemberships(false)).resolves.toEqual([]);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('lists only active memberships for the authenticated live user', async () => {
    const eqStatus = vi.fn().mockResolvedValue({
      data: [{ workspace_id: 'workspace-a', role: 'owner', workspaces: { name: 'Judith CRM' } }],
    });
    const eqUser = vi.fn().mockReturnValue({ eq: eqStatus });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    const from = vi.fn().mockReturnValue({ select });
    createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } }) },
      from,
    });

    await expect(listAvailableWorkspaceMemberships(true)).resolves.toEqual([
      { workspace_id: 'workspace-a', role: 'owner', workspaces: { name: 'Judith CRM' } },
    ]);
    expect(from).toHaveBeenCalledWith('workspace_members');
    expect(select).toHaveBeenCalledWith('workspace_id, role, workspaces(name)');
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-a');
    expect(eqStatus).toHaveBeenCalledWith('status', 'active');
  });
});
