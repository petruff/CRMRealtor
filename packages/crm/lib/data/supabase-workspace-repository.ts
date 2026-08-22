import type { SupabaseClient } from '@supabase/supabase-js';
import {
  WorkspaceAuthorityError,
  canManageWorkspaceAuthority,
  isWorkspaceRole,
  validateWorkspaceScope,
  type Workspace,
  type WorkspaceMembership,
  type WorkspaceScope,
} from '../domain/workspace.ts';
import type {
  AddWorkspaceMembershipInput,
  BootstrapWorkspaceInput,
  RevokeWorkspaceMembershipInput,
  WorkspaceAuthorityAuditAction,
  WorkspaceAuthorityAuditEvent,
  WorkspaceAuthoritySnapshot,
  WorkspaceHealthReport,
  WorkspaceRepository,
} from './workspace-repository.ts';
import { resolveSupabaseWorkspaceScope } from './supabase-workspace-scope.ts';

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceMembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: unknown;
  status: 'active' | 'revoked';
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceAuthorityAuditRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  result: 'succeeded' | 'denied' | 'failed';
  reason: string | null;
  correlation_id: string;
  created_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorityError(
  code: ConstructorParameters<typeof WorkspaceAuthorityError>[0],
  message: string,
): WorkspaceAuthorityError {
  return new WorkspaceAuthorityError(code, message);
}

function mapSupabaseError(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '23505') return authorityError('conflict', message);
  if (error.code === '42501') return authorityError('forbidden', message);
  if (error.code === '23514') return authorityError('invariant-violation', message);
  return new Error(`${message}: ${error.message}`);
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMembership(row: WorkspaceMembershipRow): WorkspaceMembership {
  if (!isWorkspaceRole(row.role)) {
    throw authorityError('invariant-violation', 'Workspace membership has an invalid role.');
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

function workspaceName(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 80 || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw authorityError('invalid-input', 'Workspace name must contain 1 to 80 printable characters.');
  }
  return clean;
}

function uuid(value: string | undefined, label: string): string {
  const resolved = value ?? globalThis.crypto.randomUUID();
  if (!UUID_PATTERN.test(resolved)) {
    throw authorityError('invalid-input', `${label} must be a UUID.`);
  }
  return resolved;
}

function rpcRow(data: unknown, label: string): WorkspaceMembershipRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw authorityError('invariant-violation', `${label} returned no membership.`);
  }
  return row as WorkspaceMembershipRow;
}

function auditAction(value: string): WorkspaceAuthorityAuditAction | undefined {
  if (value === 'workspace_bootstrapped') return 'workspace.bootstrap';
  if (value === 'workspace_renamed') return 'workspace.rename';
  if (value === 'member_added') return 'membership.add';
  if (value === 'member_reactivated') return 'membership.reactivate';
  if (value === 'member_revoked') return 'membership.revoke';
  return undefined;
}

export function supabaseWorkspaceRepository(supabase: SupabaseClient): WorkspaceRepository {
  async function authorize(untrustedScope: WorkspaceScope, ownerOnly = false) {
    const scope = validateWorkspaceScope(untrustedScope);
    if (scope.mode !== 'live') {
      throw authorityError('scope-mismatch', 'Supabase workspace repositories require live mode.');
    }

    const { data: membershipData, error: membershipError } = await supabase
      .from('workspace_members')
      .select('id, workspace_id, user_id, role, status, revoked_at, created_at, updated_at')
      .eq('id', scope.membershipId)
      .eq('workspace_id', scope.workspaceId)
      .eq('user_id', scope.authenticatedUserId)
      .maybeSingle();
    if (membershipError) {
      throw mapSupabaseError('Failed to verify workspace membership', membershipError);
    }
    if (!membershipData) {
      throw authorityError('not-found', 'Workspace membership was not found.');
    }
    const membership = toMembership(membershipData as WorkspaceMembershipRow);
    if (membership.status !== 'active') {
      throw authorityError('revoked-membership', 'Workspace membership has been revoked.');
    }
    let hasEffectiveOwnerAuthority = membership.role === 'owner';
    if (membership.role !== scope.role) {
      const eligibleForAdminElevation = membership.role === 'assistant' && scope.role === 'owner';
      if (!eligibleForAdminElevation) {
        throw authorityError('scope-mismatch', 'Workspace role does not match active membership.');
      }
      const { data: privileged, error: privilegeError } = await supabase.rpc('is_workspace_owner', {
        target_workspace_id: scope.workspaceId,
      });
      if (privilegeError) {
        throw mapSupabaseError('Failed to verify workspace administrator', privilegeError);
      }
      if (privileged !== true) {
        throw authorityError('scope-mismatch', 'Workspace administrator grant is not active.');
      }
      hasEffectiveOwnerAuthority = true;
    }

    const { data: ownerData, error: ownerError } = await supabase
      .from('workspace_members')
      .select('id, workspace_id, user_id, role, status, revoked_at, created_at, updated_at')
      .eq('workspace_id', scope.workspaceId)
      .eq('role', 'owner')
      .eq('status', 'active')
      .maybeSingle();
    if (ownerError) throw mapSupabaseError('Failed to verify workspace owner', ownerError);
    if (!ownerData || (ownerData as WorkspaceMembershipRow).user_id !== scope.ownerUserId) {
      throw authorityError('scope-mismatch', 'Workspace owner does not match compatibility authority.');
    }
    if (ownerOnly && !hasEffectiveOwnerAuthority && !canManageWorkspaceAuthority(membership.role)) {
      throw authorityError('forbidden', 'Owner authority is required.');
    }

    const { data: workspaceData, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name, created_at, updated_at')
      .eq('id', scope.workspaceId)
      .maybeSingle();
    if (workspaceError) throw mapSupabaseError('Failed to load workspace', workspaceError);
    if (!workspaceData) throw authorityError('not-found', 'Workspace was not found.');

    return {
      scope,
      membership,
      workspace: toWorkspace(workspaceData as WorkspaceRow),
    };
  }

  const snapshot = (
    authority: Awaited<ReturnType<typeof authorize>>,
  ): WorkspaceAuthoritySnapshot => ({
    workspace: authority.workspace,
    currentMembership: authority.membership,
    scope: authority.scope,
    durable: true,
  });

  return {
    async bootstrapOwner(input: BootstrapWorkspaceInput) {
      if (input.mode !== 'live') {
        throw authorityError('scope-mismatch', 'Live workspace bootstrap requires live mode.');
      }
      const scope = await resolveSupabaseWorkspaceScope(supabase, input.authenticatedUserId, {
        bootstrapWorkspaceName: workspaceName(input.name),
      });
      if (scope.role !== 'owner') {
        throw authorityError('conflict', 'Authenticated user already belongs to a workspace as assistant.');
      }
      return snapshot(await authorize(scope, true));
    },

    async show(scope) {
      return snapshot(await authorize(scope));
    },

    async listMemberships(scope) {
      const authority = await authorize(scope, true);
      const { data, error } = await supabase
        .from('workspace_members')
        .select('id, workspace_id, user_id, role, status, revoked_at, created_at, updated_at')
        .eq('workspace_id', authority.scope.workspaceId)
        .order('created_at', { ascending: true });
      if (error) throw mapSupabaseError('Failed to list workspace memberships', error);
      return ((data ?? []) as WorkspaceMembershipRow[]).map(toMembership);
    },

    async addMembership(scope, input: AddWorkspaceMembershipInput) {
      await authorize(scope, true);
      if (input.role !== 'assistant') {
        throw authorityError(
          'invalid-input',
          'Only assistant memberships can be added; ownership transfer is out of scope.',
        );
      }
      const correlationId = uuid(input.correlationId, 'Correlation ID');
      const { data, error } = await supabase.rpc('add_workspace_assistant', {
        target_user_id: input.userId,
        target_correlation_id: correlationId,
        target_reason: null,
      });
      if (error) throw mapSupabaseError('Failed to add workspace assistant', error);
      const membership = toMembership(rpcRow(data, 'Add workspace assistant'));
      if (membership.workspaceId !== scope.workspaceId || membership.role !== 'assistant') {
        throw authorityError('scope-mismatch', 'Added membership does not match workspace authority.');
      }
      return membership;
    },

    async revokeMembership(scope, input: RevokeWorkspaceMembershipInput) {
      await authorize(scope, true);
      const correlationId = uuid(input.correlationId, 'Correlation ID');
      const { data, error } = await supabase.rpc('revoke_workspace_assistant', {
        target_membership_id: input.membershipId,
        target_correlation_id: correlationId,
        target_reason: null,
      });
      if (error) throw mapSupabaseError('Failed to revoke workspace assistant', error);
      const membership = toMembership(rpcRow(data, 'Revoke workspace assistant'));
      if (
        membership.workspaceId !== scope.workspaceId
        || membership.role !== 'assistant'
        || membership.status !== 'revoked'
      ) {
        throw authorityError('scope-mismatch', 'Revoked membership does not match workspace authority.');
      }
      return membership;
    },

    async health(scope): Promise<WorkspaceHealthReport> {
      const authority = await authorize(scope, true);
      const workspaceTableProbes = [
        { table: 'contacts', column: 'id' },
        { table: 'notes', column: 'id' },
        { table: 'mailers', column: 'id' },
        { table: 'mailer_sends', column: 'mailer_id' },
        { table: 'contact_external_links', column: 'id' },
        { table: 'contact_intake_receipts', column: 'id' },
      ] as const;
      const workspaceChecks = await Promise.all(workspaceTableProbes.map(async ({ table, column }) => {
        const { error } = await supabase
          .from(table)
          .select(column)
          .eq('workspace_id', authority.scope.workspaceId)
          .limit(1);
        return { table, error };
      }));
      const failedTables = workspaceChecks
        .filter((check) => check.error)
        .map((check) => check.table);
      const repositoryStatus = failedTables.length === 0 ? 'pass' : 'fail';
      return {
        schemaVersion: 'workspace-health.v1',
        mode: 'live',
        durable: true,
        status: failedTables.length > 0 ? 'attention-required' : 'healthy',
        checkedAt: new Date().toISOString(),
        checks: [
          {
            id: 'authority-model',
            status: 'pass',
            message: 'Canonical workspace authority resolves one active owner.',
          },
          {
            id: 'active-membership',
            status: 'pass',
            message: 'Authenticated membership is active and matches the current workspace.',
          },
          {
            id: 'repository-access',
            status: repositoryStatus,
            message: failedTables.includes('contacts')
              ? 'Workspace-scoped repository access check failed.'
              : 'Repository access is bound to the verified workspace scope.',
          },
          {
            id: 'migration-backfill',
            status: repositoryStatus,
            message: failedTables.length > 0
              ? 'One or more workspace-backed CRM tables failed the canonical-scope check.'
              : 'All six migrated CRM tables expose canonical workspace scope; database constraints enforce non-null authority.',
          },
          {
            id: 'intake-binding',
            status: 'not-applicable',
            message: 'Automatic intake binding is checked by the server health command.',
          },
        ],
      };
    },

    async listAuthorityAuditEvents(scope) {
      const authority = await authorize(scope, true);
      const { data, error } = await supabase
        .from('workspace_authority_audit_events')
        .select('id, workspace_id, actor_user_id, action, result, reason, correlation_id, created_at')
        .eq('workspace_id', authority.scope.workspaceId)
        .order('created_at', { ascending: true });
      if (error) throw mapSupabaseError('Failed to load workspace authority audit', error);

      return ((data ?? []) as WorkspaceAuthorityAuditRow[]).flatMap(
        (row): WorkspaceAuthorityAuditEvent[] => {
          const action = auditAction(row.action);
          if (!action) return [];
          return [{
            id: row.id,
            actorUserId: row.actor_user_id ?? 'deleted-user',
            workspaceId: row.workspace_id,
            action,
            result: row.result,
            ...(row.reason ? { reasonCode: row.reason } : {}),
            timestamp: row.created_at,
            correlationId: row.correlation_id,
          }];
        },
      );
    },
  };
}
