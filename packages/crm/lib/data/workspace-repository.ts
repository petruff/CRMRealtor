import type {
  Workspace,
  WorkspaceMembership,
  WorkspaceMode,
  WorkspaceRole,
  WorkspaceScope,
} from '../domain/workspace.ts';

export interface WorkspaceAuthoritySnapshot {
  workspace: Workspace;
  currentMembership: WorkspaceMembership;
  scope: WorkspaceScope;
  durable: boolean;
}

export interface BootstrapWorkspaceInput {
  /** Must come from authenticated server context, never request data. */
  authenticatedUserId: string;
  name: string;
  mode: WorkspaceMode;
  correlationId?: string;
}

export interface AddWorkspaceMembershipInput {
  userId: string;
  role: WorkspaceRole;
  correlationId?: string;
}

export interface RevokeWorkspaceMembershipInput {
  membershipId: string;
  correlationId?: string;
}

export type WorkspaceAuthorityAuditAction =
  | 'workspace.bootstrap'
  | 'workspace.rename'
  | 'membership.add'
  | 'membership.reactivate'
  | 'membership.revoke';

export interface WorkspaceAuthorityAuditEvent {
  readonly id: string;
  readonly actorUserId: string;
  readonly workspaceId: string;
  readonly action: WorkspaceAuthorityAuditAction;
  readonly result: 'succeeded' | 'denied' | 'failed';
  readonly reasonCode?: string;
  readonly timestamp: string;
  readonly correlationId: string;
}

export type WorkspaceHealthCheckStatus = 'pass' | 'warning' | 'fail' | 'not-applicable';

export interface WorkspaceHealthCheck {
  readonly id:
    | 'authority-model'
    | 'active-membership'
    | 'repository-access'
    | 'migration-backfill'
    | 'intake-binding';
  readonly status: WorkspaceHealthCheckStatus;
  /** Redacted operational statement; never contains customer rows or secrets. */
  readonly message: string;
}

export interface WorkspaceHealthReport {
  readonly schemaVersion: 'workspace-health.v1';
  readonly mode: WorkspaceMode;
  readonly durable: boolean;
  readonly status: 'healthy' | 'attention-required';
  readonly checkedAt: string;
  readonly checks: readonly WorkspaceHealthCheck[];
}

/** Tenant-scoped authority seam shared by memory and live implementations. */
export interface WorkspaceRepository {
  bootstrapOwner(input: BootstrapWorkspaceInput): Promise<WorkspaceAuthoritySnapshot>;
  show(scope: WorkspaceScope): Promise<WorkspaceAuthoritySnapshot>;
  listMemberships(scope: WorkspaceScope): Promise<readonly WorkspaceMembership[]>;
  addMembership(
    scope: WorkspaceScope,
    input: AddWorkspaceMembershipInput,
  ): Promise<WorkspaceMembership>;
  revokeMembership(
    scope: WorkspaceScope,
    input: RevokeWorkspaceMembershipInput,
  ): Promise<WorkspaceMembership>;
  health(scope: WorkspaceScope): Promise<WorkspaceHealthReport>;
  listAuthorityAuditEvents(
    scope: WorkspaceScope,
  ): Promise<readonly WorkspaceAuthorityAuditEvent[]>;
}
