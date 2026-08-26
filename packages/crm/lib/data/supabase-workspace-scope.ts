import type { SupabaseClient } from '@supabase/supabase-js';
import {
  WorkspaceAuthorityError,
  isWorkspaceRole,
  validateWorkspaceScope,
  type WorkspaceScope,
} from '../domain/workspace.ts';

interface ActiveMembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: unknown;
  status: 'active';
}

interface BootstrapMembershipRow {
  workspace_id: string;
  membership_id: string;
  owner_user_id: string;
  role: unknown;
}

export interface ResolveSupabaseWorkspaceScopeOptions {
  bootstrapWorkspaceName?: string;
  selectedWorkspaceId?: string;
}

export const DEFAULT_PERSONAL_WORKSPACE_NAME = 'My Omnix Workspace';

function dataError(message: string, detail?: string): WorkspaceAuthorityError {
  return new WorkspaceAuthorityError(
    'invariant-violation',
    detail ? `${message}: ${detail}` : message,
  );
}

async function activeMembershipsForUser(
  supabase: SupabaseClient,
  authenticatedUserId: string,
): Promise<ActiveMembershipRow[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('id, workspace_id, user_id, role, status')
    .eq('user_id', authenticatedUserId)
    .eq('status', 'active')
    .limit(20);

  if (error) {
    throw dataError('Failed to resolve active workspace membership', error.message);
  }
  return (data ?? []) as ActiveMembershipRow[];
}

async function activeOwnerForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ActiveMembershipRow> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('id, workspace_id, user_id, role, status')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .limit(2);

  if (error) {
    throw dataError('Failed to resolve active workspace owner', error.message);
  }
  const owners = (data ?? []) as ActiveMembershipRow[];
  if (owners.length !== 1) {
    throw dataError('Workspace must resolve to exactly one active owner.');
  }
  const owner = owners[0];
  if (!owner) throw dataError('Workspace active owner is unavailable.');
  return owner;
}

function resolvedScope(
  authenticatedUserId: string,
  membership: ActiveMembershipRow,
  owner: ActiveMembershipRow,
): WorkspaceScope {
  if (
    membership.user_id !== authenticatedUserId
    || membership.status !== 'active'
    || owner.workspace_id !== membership.workspace_id
    || owner.role !== 'owner'
    || owner.status !== 'active'
    || !isWorkspaceRole(membership.role)
    || (membership.role === 'owner'
      && (membership.id !== owner.id || membership.user_id !== owner.user_id))
  ) {
    throw dataError('Workspace membership authority is inconsistent.');
  }

  return validateWorkspaceScope({
    authenticatedUserId,
    ownerUserId: owner.user_id,
    membershipId: membership.id,
    workspaceId: membership.workspace_id,
    role: membership.role,
    mode: 'live',
    supportGrant: null,
  });
}

/**
 * Resolves the only active membership for the authenticated user. A personal
 * workspace is bootstrapped only for a first-time user with zero memberships;
 * ambiguity always fails closed.
 */
export async function resolveSupabaseWorkspaceScope(
  supabase: SupabaseClient,
  authenticatedUserId: string,
  options: ResolveSupabaseWorkspaceScopeOptions = {},
): Promise<WorkspaceScope> {
  const memberships = await activeMembershipsForUser(supabase, authenticatedUserId);

  if (memberships.length === 0) {
    const workspaceName = options.bootstrapWorkspaceName?.trim()
      || DEFAULT_PERSONAL_WORKSPACE_NAME;
    const { data, error } = await supabase.rpc('bootstrap_personal_workspace', {
      workspace_name: workspaceName,
    });
    if (error) {
      throw dataError('Failed to bootstrap personal workspace', error.message);
    }
    const bootstrap = (Array.isArray(data) ? data[0] : data) as BootstrapMembershipRow | null;
    if (!bootstrap) {
      throw dataError('Personal workspace bootstrap returned no active membership.');
    }
    if (bootstrap.role !== 'owner' || bootstrap.owner_user_id !== authenticatedUserId) {
      throw dataError('Personal workspace bootstrap returned invalid canonical owner authority.');
    }
    return validateWorkspaceScope({
      authenticatedUserId,
      ownerUserId: bootstrap.owner_user_id,
      membershipId: bootstrap.membership_id,
      workspaceId: bootstrap.workspace_id,
      role: bootstrap.role,
      mode: 'live',
      supportGrant: null,
    });
  }

  const selectedWorkspaceId = options.selectedWorkspaceId?.trim();
  const membership = memberships.length === 1
    ? memberships[0]
    : memberships.find((candidate) => candidate.workspace_id === selectedWorkspaceId)
      ?? memberships.find((candidate) => candidate.role === 'owner');
  if (!membership) throw dataError('Active workspace membership is unavailable.');
  const owner = await activeOwnerForWorkspace(supabase, membership.workspace_id);
  if (membership.role === 'owner') {
    return resolvedScope(authenticatedUserId, membership, owner);
  }
  const { data: supportGrantId, error: supportError } = await supabase.rpc(
    'resolve_workspace_support_grant_id',
    { target_workspace_id: membership.workspace_id },
  );
  if (supportError) {
    throw dataError('Failed to resolve workspace support authority', supportError.message);
  }
  return validateWorkspaceScope({
    ...resolvedScope(authenticatedUserId, membership, owner),
    supportGrant: typeof supportGrantId === 'string'
      ? { grantId: supportGrantId, active: true }
      : null,
  });
}
