import type {
  WorkspaceAuthoritySnapshot,
  WorkspaceHealthReport,
  WorkspaceRepository,
} from '../data/workspace-repository.ts';
import {
  WorkspaceAuthorityError,
  type WorkspaceMembership,
  type WorkspaceMode,
  type WorkspaceScope,
} from '../domain/workspace.ts';

const WORKSPACE_NAME_MAX = 120;

export interface WorkspaceBootstrapAuthority {
  /** Derived from the authenticated session or the explicit sample fixture. */
  authenticatedUserId: string;
  mode: WorkspaceMode;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new WorkspaceAuthorityError('invalid-input', `${label} is required.`);
  }
  const clean = value.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clean)) {
    throw new WorkspaceAuthorityError('invalid-input', `${label} is invalid.`);
  }
  return clean;
}

function optionalCorrelationId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return identifier(value, 'Correlation ID');
}

function name(value: unknown): string {
  if (typeof value !== 'string') {
    throw new WorkspaceAuthorityError('invalid-input', 'Workspace name is required.');
  }
  const clean = value.trim();
  if (!clean) throw new WorkspaceAuthorityError('invalid-input', 'Workspace name is required.');
  if (clean.length > WORKSPACE_NAME_MAX || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new WorkspaceAuthorityError(
      'invalid-input',
      `Workspace name must use ${WORKSPACE_NAME_MAX} printable characters or fewer.`,
    );
  }
  return clean;
}

export async function bootstrapWorkspaceCommand(
  repository: WorkspaceRepository,
  authority: WorkspaceBootstrapAuthority,
  input: { name?: unknown; correlationId?: unknown },
): Promise<WorkspaceAuthoritySnapshot> {
  return repository.bootstrapOwner({
    authenticatedUserId: identifier(authority.authenticatedUserId, 'Authenticated user'),
    mode: authority.mode,
    name: name(input.name),
    correlationId: optionalCorrelationId(input.correlationId),
  });
}

export async function showWorkspaceCommand(
  repository: WorkspaceRepository,
  scope: WorkspaceScope,
): Promise<WorkspaceAuthoritySnapshot> {
  return repository.show(scope);
}

export async function listWorkspaceMembershipsCommand(
  repository: WorkspaceRepository,
  scope: WorkspaceScope,
): Promise<readonly WorkspaceMembership[]> {
  return repository.listMemberships(scope);
}

export async function addWorkspaceMembershipCommand(
  repository: WorkspaceRepository,
  scope: WorkspaceScope,
  input: { userId?: unknown; role?: unknown; correlationId?: unknown },
): Promise<WorkspaceMembership> {
  if (input.role !== undefined && input.role !== 'assistant') {
    throw new WorkspaceAuthorityError(
      'invalid-input',
      'Only the assistant role can be added in the initial product.',
    );
  }
  return repository.addMembership(scope, {
    userId: identifier(input.userId, 'User'),
    role: 'assistant',
    correlationId: optionalCorrelationId(input.correlationId),
  });
}

export async function revokeWorkspaceMembershipCommand(
  repository: WorkspaceRepository,
  scope: WorkspaceScope,
  input: { membershipId?: unknown; correlationId?: unknown },
): Promise<WorkspaceMembership> {
  return repository.revokeMembership(scope, {
    membershipId: identifier(input.membershipId, 'Membership'),
    correlationId: optionalCorrelationId(input.correlationId),
  });
}

export async function workspaceHealthCommand(
  repository: WorkspaceRepository,
  scope: WorkspaceScope,
): Promise<WorkspaceHealthReport> {
  return repository.health(scope);
}
