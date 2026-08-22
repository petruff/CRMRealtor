/** Canonical tenant and membership contracts for Omnix. */

export const WORKSPACE_ROLES = ['owner', 'assistant'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_MEMBERSHIP_STATUSES = ['active', 'revoked'] as const;
export type WorkspaceMembershipStatus = (typeof WORKSPACE_MEMBERSHIP_STATUSES)[number];

export type WorkspaceMode = 'live' | 'sample';

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
});

export const SAMPLE_ASSISTANT_SCOPE: WorkspaceScope = Object.freeze({
  authenticatedUserId: SAMPLE_ASSISTANT_USER_ID,
  ownerUserId: SAMPLE_OWNER_USER_ID,
  membershipId: SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  workspaceId: SAMPLE_WORKSPACE_ID,
  role: 'assistant',
  mode: 'sample',
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
  return {
    authenticatedUserId,
    ownerUserId,
    membershipId,
    workspaceId,
    role: scope.role,
    mode: scope.mode,
  };
}

export function canManageWorkspaceAuthority(role: WorkspaceRole): boolean {
  return role === 'owner';
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
