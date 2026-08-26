/** Canonical tenant and membership contracts for Omnix. */

export const WORKSPACE_ROLES = ['owner', 'assistant'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_MEMBERSHIP_STATUSES = ['active', 'revoked'] as const;
export type WorkspaceMembershipStatus = (typeof WORKSPACE_MEMBERSHIP_STATUSES)[number];

export type WorkspaceMode = 'live' | 'sample';

export const WORKSPACE_SUPPORT_OPERATIONS = [
  'workspace.memberships.read',
  'workspace.health.read',
  'workspace.authority-audit.read',
] as const;
export type WorkspaceSupportOperation = (typeof WORKSPACE_SUPPORT_OPERATIONS)[number];

export interface WorkspaceSupportGrant {
  readonly grantId: string;
  readonly active: true;
}

export interface WorkspaceSupportGrantInput {
  readonly grantId?: string;
  readonly active: true;
}

export interface WorkspaceAuthority {
  readonly actorUserId: string;
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly membershipRole: WorkspaceRole;
  readonly canonicalOwnerUserId: string;
  readonly supportGrant: WorkspaceSupportGrant | null;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceMembership {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly status: WorkspaceMembershipStatus;
  readonly joinedAt: string;
  readonly updatedAt: string;
  readonly revokedAt?: string;
}

/**
 * Authority passed to repositories and commands. Values are derived from an
 * authenticated, active membership; callers never select tenant authority.
 */
export interface WorkspaceScope {
  readonly authenticatedUserId: string;
  /** Active owner retained only for legacy owner_id compatibility writes. */
  readonly ownerUserId: string;
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly mode: WorkspaceMode;
  /** Separately verified support capability; never changes membership role. */
  readonly supportGrant?: WorkspaceSupportGrantInput | null;
}

export const SAMPLE_WORKSPACE_ID = 'workspace-sample';
export const SAMPLE_OWNER_USER_ID = 'user-sample-owner';
export const SAMPLE_OWNER_MEMBERSHIP_ID = 'membership-sample-owner';
export const SAMPLE_ASSISTANT_USER_ID = 'user-sample-assistant';
export const SAMPLE_ASSISTANT_MEMBERSHIP_ID = 'membership-sample-assistant';

export const SAMPLE_WORKSPACE_SCOPE: WorkspaceScope = Object.freeze({
  authenticatedUserId: SAMPLE_OWNER_USER_ID,
  ownerUserId: SAMPLE_OWNER_USER_ID,
  membershipId: SAMPLE_OWNER_MEMBERSHIP_ID,
  workspaceId: SAMPLE_WORKSPACE_ID,
  role: 'owner',
  mode: 'sample',
  supportGrant: null,
});

export const SAMPLE_ASSISTANT_SCOPE: WorkspaceScope = Object.freeze({
  authenticatedUserId: SAMPLE_ASSISTANT_USER_ID,
  ownerUserId: SAMPLE_OWNER_USER_ID,
  membershipId: SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  workspaceId: SAMPLE_WORKSPACE_ID,
  role: 'assistant',
  mode: 'sample',
  supportGrant: null,
});

export const WORKSPACE_AUTHORITY_ERROR_CODES = [
  'invalid-input',
  'forbidden',
  'not-found',
  'conflict',
  'invariant-violation',
  'revoked-membership',
  'scope-mismatch',
] as const;

export type WorkspaceAuthorityErrorCode = (typeof WORKSPACE_AUTHORITY_ERROR_CODES)[number];

export class WorkspaceAuthorityError extends Error {
  readonly code: WorkspaceAuthorityErrorCode;

  constructor(code: WorkspaceAuthorityErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceAuthorityError';
    this.code = code;
  }
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && WORKSPACE_ROLES.includes(value as WorkspaceRole);
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return value === 'live' || value === 'sample';
}

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new WorkspaceAuthorityError('invalid-input', `${label} is required.`);
  }
  const clean = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clean)) {
    throw new WorkspaceAuthorityError('invalid-input', `${label} is invalid.`);
  }
  return clean;
}

/** Validates the shape without granting authority; repositories still verify membership. */
export function validateWorkspaceScope(scope: WorkspaceScope): WorkspaceScope {
  const authenticatedUserId = requiredIdentifier(scope.authenticatedUserId, 'Authenticated user');
  const ownerUserId = requiredIdentifier(scope.ownerUserId, 'Workspace owner');
  const membershipId = requiredIdentifier(scope.membershipId, 'Membership');
  const workspaceId = requiredIdentifier(scope.workspaceId, 'Workspace');
  if (!isWorkspaceRole(scope.role)) {
    throw new WorkspaceAuthorityError('invalid-input', 'Workspace role is invalid.');
  }
  if (!isWorkspaceMode(scope.mode)) {
    throw new WorkspaceAuthorityError('invalid-input', 'Workspace mode is invalid.');
  }
  let supportGrant: WorkspaceSupportGrant | null | undefined;
  if (scope.supportGrant !== undefined && scope.supportGrant !== null) {
    if (scope.supportGrant.active !== true) {
      throw new WorkspaceAuthorityError('invalid-input', 'Workspace support grant is invalid.');
    }
    supportGrant = typeof scope.supportGrant.grantId === 'string'
      ? {
          grantId: requiredIdentifier(scope.supportGrant.grantId, 'Workspace support grant'),
          active: true,
        }
      : null;
  } else {
    supportGrant = scope.supportGrant;
  }
  return {
    authenticatedUserId,
    ownerUserId,
    membershipId,
    workspaceId,
    role: scope.role,
    mode: scope.mode,
    ...(supportGrant !== undefined ? { supportGrant } : {}),
  };
}

export function workspaceAuthority(scopeInput: WorkspaceScope): WorkspaceAuthority {
  const scope = validateWorkspaceScope(scopeInput);
  const supportGrant = scope.supportGrant?.grantId
    ? { grantId: scope.supportGrant.grantId, active: true as const }
    : null;
  return {
    actorUserId: scope.authenticatedUserId,
    workspaceId: scope.workspaceId,
    membershipId: scope.membershipId,
    membershipRole: scope.role,
    canonicalOwnerUserId: scope.ownerUserId,
    supportGrant,
  };
}

export function isCanonicalWorkspaceOwner(authority: WorkspaceAuthority): boolean {
  return authority.membershipRole === 'owner'
    && authority.actorUserId === authority.canonicalOwnerUserId;
}

export function isCanonicalWorkspaceOwnerScope(scope: WorkspaceScope): boolean {
  return isCanonicalWorkspaceOwner(workspaceAuthority(scope));
}

export function assertCanonicalWorkspaceOwner(scopeInput: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(scopeInput);
  if (!isCanonicalWorkspaceOwnerScope(scope)) {
    throw new WorkspaceAuthorityError('forbidden', 'Canonical workspace owner authority is required.');
  }
  return scope;
}

export function canManageWorkspaceAuthority(scopeOrRole: WorkspaceScope | WorkspaceRole): boolean {
  if (typeof scopeOrRole === 'string') return scopeOrRole === 'owner';
  return isCanonicalWorkspaceOwnerScope(scopeOrRole);
}

export function canPerformWorkspaceSupportOperation(
  scopeInput: WorkspaceScope,
  operation: unknown,
): operation is WorkspaceSupportOperation {
  const authority = workspaceAuthority(scopeInput);
  if (!WORKSPACE_SUPPORT_OPERATIONS.includes(operation as WorkspaceSupportOperation)) return false;
  return isCanonicalWorkspaceOwner(authority) || authority.supportGrant?.active === true;
}

/** Enforces the product's one-active-owner and one-active-membership invariants. */
export function assertWorkspaceMembershipInvariants(
  workspaceId: string,
  memberships: readonly WorkspaceMembership[],
): void {
  const scoped = memberships.filter((membership) => membership.workspaceId === workspaceId);
  const membershipIds = new Set<string>();
  const activeUsers = new Set<string>();
  let activeOwners = 0;

  for (const membership of scoped) {
    if (membershipIds.has(membership.id)) {
      throw new WorkspaceAuthorityError('invariant-violation', 'Membership IDs must be unique.');
    }
    membershipIds.add(membership.id);
    if (membership.status !== 'active') continue;
    if (activeUsers.has(membership.userId)) {
      throw new WorkspaceAuthorityError(
        'invariant-violation',
        'A user cannot have duplicate active membership in one workspace.',
      );
    }
    activeUsers.add(membership.userId);
    if (membership.role === 'owner') activeOwners += 1;
  }

  if (activeOwners !== 1) {
    throw new WorkspaceAuthorityError(
      'invariant-violation',
      'A workspace must have exactly one active owner.',
    );
  }
}
