import { describe, expect, it } from 'vitest';
import {
  SAMPLE_WORKSPACE_SCOPE,
  WorkspaceAuthorityError,
  assertCanonicalWorkspaceOwner,
  assertWorkspaceMembershipInvariants,
  canPerformWorkspaceSupportOperation,
  canManageWorkspaceAuthority,
  workspaceAuthority,
  validateWorkspaceScope,
  type WorkspaceMembership,
} from './workspace';

const joinedAt = '2026-08-11T12:00:00.000Z';

function membership(
  value: Partial<WorkspaceMembership> & Pick<WorkspaceMembership, 'id' | 'userId' | 'role'>,
): WorkspaceMembership {
  return {
    workspaceId: 'workspace-a',
    status: 'active',
    joinedAt,
    updatedAt: joinedAt,
    ...value,
  };
}

describe('workspace domain', () => {
  it('provides an explicit, non-live sample scope', () => {
    expect(validateWorkspaceScope(SAMPLE_WORKSPACE_SCOPE)).toEqual(SAMPLE_WORKSPACE_SCOPE);
    expect(SAMPLE_WORKSPACE_SCOPE.mode).toBe('sample');
    expect(Object.isFrozen(SAMPLE_WORKSPACE_SCOPE)).toBe(true);
  });

  it('rejects malformed scope values before repository authorization', () => {
    expect(() => validateWorkspaceScope({
      ...SAMPLE_WORKSPACE_SCOPE,
      workspaceId: '../workspace-b',
    })).toThrowError(WorkspaceAuthorityError);
    expect(() => validateWorkspaceScope({
      ...SAMPLE_WORKSPACE_SCOPE,
      role: 'admin' as 'owner',
    })).toThrow('Workspace role is invalid');
  });

  it('allows only owners to manage workspace authority', () => {
    expect(canManageWorkspaceAuthority('owner')).toBe(true);
    expect(canManageWorkspaceAuthority('assistant')).toBe(false);
    expect(canManageWorkspaceAuthority(SAMPLE_WORKSPACE_SCOPE)).toBe(true);
    expect(canManageWorkspaceAuthority({
      ...SAMPLE_WORKSPACE_SCOPE,
      authenticatedUserId: SAMPLE_WORKSPACE_SCOPE.authenticatedUserId,
      ownerUserId: 'different-owner',
    })).toBe(false);
  });

  it('keeps canonical ownership separate from named support authority', () => {
    const supportScope = {
      ...SAMPLE_WORKSPACE_SCOPE,
      authenticatedUserId: 'support-user',
      membershipId: 'support-membership',
      role: 'assistant' as const,
      supportGrant: { grantId: 'grant-support-a', active: true as const },
    };
    expect(workspaceAuthority(supportScope)).toMatchObject({
      actorUserId: 'support-user',
      membershipRole: 'assistant',
      canonicalOwnerUserId: SAMPLE_WORKSPACE_SCOPE.ownerUserId,
      supportGrant: { grantId: 'grant-support-a', active: true },
    });
    expect(canPerformWorkspaceSupportOperation(
      supportScope,
      'workspace.authority-audit.read',
    )).toBe(true);
    expect(canPerformWorkspaceSupportOperation(supportScope, 'workspace.memberships.write')).toBe(false);
    expect(() => assertCanonicalWorkspaceOwner(supportScope)).toThrow(/canonical workspace owner/i);
  });

  it('rejects a forged owner role when the actor is not the canonical owner', () => {
    expect(() => assertCanonicalWorkspaceOwner({
      ...SAMPLE_WORKSPACE_SCOPE,
      authenticatedUserId: 'support-user',
      membershipId: 'support-membership',
      role: 'owner',
      supportGrant: { grantId: 'grant-support-a', active: true },
    })).toThrow(/canonical workspace owner/i);
  });

  it('fails closed when support authority has no auditable grant identity', () => {
    const unresolvedScope = validateWorkspaceScope({
      ...SAMPLE_WORKSPACE_SCOPE,
      authenticatedUserId: 'support-user',
      membershipId: 'support-membership',
      role: 'assistant',
      supportGrant: { active: true },
    });
    expect(unresolvedScope.supportGrant).toBeNull();
    expect(canPerformWorkspaceSupportOperation(
      unresolvedScope,
      'workspace.authority-audit.read',
    )).toBe(false);
  });

  it('accepts one owner and any number of distinct active assistants', () => {
    expect(() => assertWorkspaceMembershipInvariants('workspace-a', [
      membership({ id: 'm-owner', userId: 'u-owner', role: 'owner' }),
      membership({ id: 'm-assistant', userId: 'u-assistant', role: 'assistant' }),
      membership({
        id: 'm-old-assistant',
        userId: 'u-assistant',
        role: 'assistant',
        status: 'revoked',
        revokedAt: joinedAt,
      }),
    ])).not.toThrow();
  });

  it('rejects zero owners, multiple owners, duplicate active users, and duplicate IDs', () => {
    const owner = membership({ id: 'm-owner', userId: 'u-owner', role: 'owner' });
    expect(() => assertWorkspaceMembershipInvariants('workspace-a', [])).toThrow(
      'exactly one active owner',
    );
    expect(() => assertWorkspaceMembershipInvariants('workspace-a', [
      owner,
      membership({ id: 'm-owner-2', userId: 'u-owner-2', role: 'owner' }),
    ])).toThrow('exactly one active owner');
    expect(() => assertWorkspaceMembershipInvariants('workspace-a', [
      owner,
      membership({ id: 'm-assistant', userId: 'u-owner', role: 'assistant' }),
    ])).toThrow('duplicate active membership');
    expect(() => assertWorkspaceMembershipInvariants('workspace-a', [
      owner,
      membership({ id: 'm-owner', userId: 'u-assistant', role: 'assistant' }),
    ])).toThrow('Membership IDs must be unique');
  });
});
