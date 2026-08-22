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
import {
  SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  SAMPLE_ASSISTANT_USER_ID,
  SAMPLE_OWNER_MEMBERSHIP_ID,
  SAMPLE_OWNER_USER_ID,
  SAMPLE_WORKSPACE_ID,
  WorkspaceAuthorityError,
  assertWorkspaceMembershipInvariants,
  canManageWorkspaceAuthority,
  validateWorkspaceScope,
  type Workspace,
  type WorkspaceMembership,
  type WorkspaceMode,
  type WorkspaceScope,
} from '../domain/workspace.ts';

export interface MemoryWorkspaceState {
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEvents: WorkspaceAuthorityAuditEvent[];
}

export interface MemoryWorkspaceRepositoryOptions {
  mode?: WorkspaceMode;
  durable?: boolean;
  initialState?: MemoryWorkspaceState;
  clock?: () => Date;
  idFactory?: (kind: 'workspace' | 'membership' | 'audit' | 'correlation') => string;
}

let fallbackIdSequence = 0;

function defaultIdFactory(kind: 'workspace' | 'membership' | 'audit' | 'correlation'): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${fallbackIdSequence += 1}`;
  return `${kind}-${value}`;
}

function cloneWorkspace(workspace: Workspace): Workspace {
  return { ...workspace };
}

function cloneMembership(membership: WorkspaceMembership): WorkspaceMembership {
  return { ...membership };
}

function cloneAuditEvent(event: WorkspaceAuthorityAuditEvent): WorkspaceAuthorityAuditEvent {
  return { ...event };
}

function identifier(value: string, label: string): string {
  const clean = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clean)) {
    throw new WorkspaceAuthorityError('invalid-input', `${label} is invalid.`);
  }
  return clean;
}

function workspaceName(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 120 || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new WorkspaceAuthorityError(
      'invalid-input',
      'Workspace name must contain 1 to 120 printable characters.',
    );
  }
  return clean;
}

function copyState(initial?: MemoryWorkspaceState): MemoryWorkspaceState {
  return {
    workspaces: initial?.workspaces.map(cloneWorkspace) ?? [],
    memberships: initial?.memberships.map(cloneMembership) ?? [],
    auditEvents: initial?.auditEvents.map(cloneAuditEvent) ?? [],
  };
}

export function createMemoryWorkspaceRepository(
  options: MemoryWorkspaceRepositoryOptions = {},
): WorkspaceRepository {
  const mode = options.mode ?? 'sample';
  const durable = options.durable ?? false;
  const clock = options.clock ?? (() => new Date());
  const makeId = options.idFactory ?? defaultIdFactory;
  const state = copyState(options.initialState);

  if (new Set(state.workspaces.map((workspace) => workspace.id)).size !== state.workspaces.length) {
    throw new WorkspaceAuthorityError('invariant-violation', 'Workspace IDs must be unique.');
  }
  if (state.memberships.some((membership) => (
    !state.workspaces.some((workspace) => workspace.id === membership.workspaceId)
  ))) {
    throw new WorkspaceAuthorityError(
      'invariant-violation',
      'Every membership must reference an existing workspace.',
    );
  }
  for (const workspace of state.workspaces) {
    assertWorkspaceMembershipInvariants(workspace.id, state.memberships);
  }

  const timestamp = () => clock().toISOString();
  const correlation = (value?: string) => (
    value ? identifier(value, 'Correlation ID') : makeId('correlation')
  );

  const recordAudit = (
    actorUserId: string,
    workspaceId: string,
    action: WorkspaceAuthorityAuditAction,
    result: 'succeeded' | 'denied',
    correlationId: string,
    reasonCode?: string,
  ) => {
    state.auditEvents.push({
      id: makeId('audit'),
      actorUserId,
      workspaceId,
      action,
      result,
      reasonCode,
      timestamp: timestamp(),
      correlationId,
    });
  };

  const authorize = (untrustedScope: WorkspaceScope, ownerOnly = false) => {
    const scope = validateWorkspaceScope(untrustedScope);
    if (scope.mode !== mode) {
      throw new WorkspaceAuthorityError('scope-mismatch', 'Workspace mode does not match repository mode.');
    }
    const membership = state.memberships.find((item) => item.id === scope.membershipId);
    if (!membership) {
      throw new WorkspaceAuthorityError('not-found', 'Active workspace membership was not found.');
    }
    if (membership.status !== 'active') {
      throw new WorkspaceAuthorityError('revoked-membership', 'Workspace membership has been revoked.');
    }
    if (
      membership.workspaceId !== scope.workspaceId
      || membership.userId !== scope.authenticatedUserId
      || membership.role !== scope.role
    ) {
      throw new WorkspaceAuthorityError('scope-mismatch', 'Workspace scope does not match membership authority.');
    }
    const workspace = state.workspaces.find((item) => item.id === scope.workspaceId);
    if (!workspace) throw new WorkspaceAuthorityError('not-found', 'Workspace was not found.');
    const activeOwner = state.memberships.find((item) => (
      item.workspaceId === workspace.id
      && item.role === 'owner'
      && item.status === 'active'
    ));
    if (!activeOwner || activeOwner.userId !== scope.ownerUserId) {
      throw new WorkspaceAuthorityError(
        'scope-mismatch',
        'Workspace scope does not match the active owner compatibility authority.',
      );
    }
    if (ownerOnly && !canManageWorkspaceAuthority(membership.role)) {
      throw new WorkspaceAuthorityError('forbidden', 'Owner authority is required.');
    }
    return { scope, workspace, membership };
  };

  const snapshot = (
    workspace: Workspace,
    membership: WorkspaceMembership,
    scope: WorkspaceScope,
  ): WorkspaceAuthoritySnapshot => ({
    workspace: cloneWorkspace(workspace),
    currentMembership: cloneMembership(membership),
    scope: { ...scope },
    durable,
  });

  const ownerAction = async <T>(
    untrustedScope: WorkspaceScope,
    action: Exclude<WorkspaceAuthorityAuditAction, 'workspace.bootstrap'>,
    correlationId: string | undefined,
    work: (authority: ReturnType<typeof authorize>) => T,
  ): Promise<T> => {
    const resolvedCorrelation = correlation(correlationId);
    try {
      const authority = authorize(untrustedScope, true);
      const result = work(authority);
      recordAudit(
        authority.scope.authenticatedUserId,
        authority.scope.workspaceId,
        action,
        'succeeded',
        resolvedCorrelation,
      );
      return result;
    } catch (error) {
      const code = error instanceof WorkspaceAuthorityError ? error.code : 'internal-error';
      recordAudit(
        untrustedScope.authenticatedUserId,
        untrustedScope.workspaceId,
        action,
        'denied',
        resolvedCorrelation,
        code,
      );
      throw error;
    }
  };

  return {
    async bootstrapOwner(input: BootstrapWorkspaceInput) {
      const userId = identifier(input.authenticatedUserId, 'Authenticated user');
      const name = workspaceName(input.name);
      const correlationId = correlation(input.correlationId);
      if (input.mode !== mode) {
        throw new WorkspaceAuthorityError('scope-mismatch', 'Bootstrap mode does not match repository mode.');
      }
      if (state.memberships.some((item) => item.userId === userId && item.status === 'active')) {
        throw new WorkspaceAuthorityError('conflict', 'Authenticated user already has active membership.');
      }
      const createdAt = timestamp();
      const workspaceId = makeId('workspace');
      const membershipId = makeId('membership');
      if (state.workspaces.some((item) => item.id === workspaceId)) {
        throw new WorkspaceAuthorityError('invariant-violation', 'Generated workspace ID is not unique.');
      }
      if (state.memberships.some((item) => item.id === membershipId)) {
        throw new WorkspaceAuthorityError('invariant-violation', 'Generated membership ID is not unique.');
      }
      const workspace: Workspace = {
        id: workspaceId,
        name,
        createdAt,
        updatedAt: createdAt,
      };
      const membership: WorkspaceMembership = {
        id: membershipId,
        workspaceId: workspace.id,
        userId,
        role: 'owner',
        status: 'active',
        joinedAt: createdAt,
        updatedAt: createdAt,
      };
      state.workspaces.push(workspace);
      state.memberships.push(membership);
      assertWorkspaceMembershipInvariants(workspace.id, state.memberships);
      const scope: WorkspaceScope = {
        authenticatedUserId: userId,
        ownerUserId: userId,
        membershipId: membership.id,
        workspaceId: workspace.id,
        role: 'owner',
        mode,
      };
      recordAudit(
        userId,
        workspace.id,
        'workspace.bootstrap',
        'succeeded',
        correlationId,
      );
      return snapshot(workspace, membership, scope);
    },

    async show(scope) {
      const authority = authorize(scope);
      return snapshot(authority.workspace, authority.membership, authority.scope);
    },

    async listMemberships(scope) {
      const authority = authorize(scope, true);
      return state.memberships
        .filter((item) => item.workspaceId === authority.workspace.id)
        .map(cloneMembership)
        .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.id.localeCompare(right.id));
    },

    async addMembership(scope, input: AddWorkspaceMembershipInput) {
      return ownerAction(scope, 'membership.add', input.correlationId, ({ workspace }) => {
        const userId = identifier(input.userId, 'User');
        if (input.role !== 'assistant') {
          throw new WorkspaceAuthorityError(
            'invalid-input',
            'Only assistant memberships can be added; ownership transfer is out of scope.',
          );
        }
        if (state.memberships.some((item) => (
          item.workspaceId === workspace.id
          && item.userId === userId
          && item.status === 'active'
        ))) {
          throw new WorkspaceAuthorityError('conflict', 'User already has active workspace membership.');
        }
        const joinedAt = timestamp();
        const membershipId = makeId('membership');
        if (state.memberships.some((item) => item.id === membershipId)) {
          throw new WorkspaceAuthorityError('invariant-violation', 'Generated membership ID is not unique.');
        }
        const membership: WorkspaceMembership = {
          id: membershipId,
          workspaceId: workspace.id,
          userId,
          role: 'assistant',
          status: 'active',
          joinedAt,
          updatedAt: joinedAt,
        };
        state.memberships.push(membership);
        assertWorkspaceMembershipInvariants(workspace.id, state.memberships);
        return cloneMembership(membership);
      });
    },

    async revokeMembership(scope, input: RevokeWorkspaceMembershipInput) {
      return ownerAction(scope, 'membership.revoke', input.correlationId, ({ workspace }) => {
        const membershipId = identifier(input.membershipId, 'Membership');
        const index = state.memberships.findIndex((item) => (
          item.id === membershipId && item.workspaceId === workspace.id
        ));
        if (index < 0) throw new WorkspaceAuthorityError('not-found', 'Workspace membership was not found.');
        const target = state.memberships[index];
        if (!target) throw new WorkspaceAuthorityError('not-found', 'Workspace membership was not found.');
        if (target.role === 'owner') {
          throw new WorkspaceAuthorityError('invariant-violation', 'The active owner cannot be revoked.');
        }
        if (target.status === 'revoked') return cloneMembership(target);
        const revokedAt = timestamp();
        const revoked: WorkspaceMembership = {
          ...target,
          status: 'revoked',
          updatedAt: revokedAt,
          revokedAt,
        };
        state.memberships[index] = revoked;
        assertWorkspaceMembershipInvariants(workspace.id, state.memberships);
        return cloneMembership(revoked);
      });
    },

    async health(scope): Promise<WorkspaceHealthReport> {
      authorize(scope, true);
      const checks: WorkspaceHealthReport['checks'] = [
        {
          id: 'authority-model',
          status: 'pass',
          message: 'One active owner and unique active memberships are enforced.',
        },
        {
          id: 'active-membership',
          status: 'pass',
          message: 'Authenticated membership is active and matches the current workspace.',
        },
        {
          id: 'repository-access',
          status: 'pass',
          message: 'Repository access is bound to the verified workspace scope.',
        },
        {
          id: 'migration-backfill',
          status: 'not-applicable',
          message: 'Sample mode is process-only and does not use the live migration.',
        },
        {
          id: 'intake-binding',
          status: 'not-applicable',
          message: 'Sample mode does not accept automatic intake writes.',
        },
      ];
      return {
        schemaVersion: 'workspace-health.v1',
        mode,
        durable,
        status: 'healthy',
        checkedAt: timestamp(),
        checks,
      };
    },

    async listAuthorityAuditEvents(scope) {
      const authority = authorize(scope, true);
      return state.auditEvents
        .filter((event) => event.workspaceId === authority.workspace.id)
        .map(cloneAuditEvent);
    },
  };
}

export function sampleWorkspaceState(includeAssistant = false): MemoryWorkspaceState {
  const timestamp = '2026-08-11T12:00:00.000Z';
  const memberships: WorkspaceMembership[] = [{
    id: SAMPLE_OWNER_MEMBERSHIP_ID,
    workspaceId: SAMPLE_WORKSPACE_ID,
    userId: SAMPLE_OWNER_USER_ID,
    role: 'owner',
    status: 'active',
    joinedAt: timestamp,
    updatedAt: timestamp,
  }];
  if (includeAssistant) {
    memberships.push({
      id: SAMPLE_ASSISTANT_MEMBERSHIP_ID,
      workspaceId: SAMPLE_WORKSPACE_ID,
      userId: SAMPLE_ASSISTANT_USER_ID,
      role: 'assistant',
      status: 'active',
      joinedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return {
    workspaces: [{
      id: SAMPLE_WORKSPACE_ID,
      name: 'Omnix Sample Workspace',
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    memberships,
    auditEvents: [],
  };
}

/** Explicitly non-durable sample adapter using the same authority contract. */
export function createSampleWorkspaceRepository(includeAssistant = false): WorkspaceRepository {
  return createMemoryWorkspaceRepository({
    mode: 'sample',
    durable: false,
    initialState: sampleWorkspaceState(includeAssistant),
  });
}
