import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  SAMPLE_ASSISTANT_SCOPE,
  SAMPLE_OWNER_USER_ID,
  SAMPLE_WORKSPACE_SCOPE,
} from '@/lib/domain/workspace';
import {
  createMemoryWorkspaceRepository,
  createSampleWorkspaceRepository,
} from '@/lib/data/memory-workspace-repository';
import {
  addWorkspaceMembershipCommand,
  bootstrapWorkspaceCommand,
  listWorkspaceMembershipsCommand,
  revokeWorkspaceMembershipCommand,
  showWorkspaceCommand,
  workspaceHealthCommand,
} from './workspace-commands';

describe('workspace commands', () => {
  it('bootstraps from trusted authority without accepting tenant IDs', async () => {
    const repository = createMemoryWorkspaceRepository({
      idFactory: (kind) => `${kind}-generated`,
      clock: () => new Date('2026-08-11T12:00:00.000Z'),
    });
    const result = await bootstrapWorkspaceCommand(
      repository,
      { authenticatedUserId: 'owner-a', mode: 'sample' },
      { name: '  Realtor team  ', correlationId: 'request-a' },
    );
    expect(result).toMatchObject({
      workspace: { id: 'workspace-generated', name: 'Realtor team' },
      scope: {
        authenticatedUserId: 'owner-a',
        ownerUserId: 'owner-a',
        workspaceId: 'workspace-generated',
        role: 'owner',
      },
    });
  });

  it('validates bootstrap data before any repository write', async () => {
    const repository = createMemoryWorkspaceRepository();
    await expect(bootstrapWorkspaceCommand(
      repository,
      { authenticatedUserId: 'owner-a', mode: 'sample' },
      { name: '   ' },
    )).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(bootstrapWorkspaceCommand(
      repository,
      { authenticatedUserId: '../owner', mode: 'sample' },
      { name: 'Workspace' },
    )).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('shows and lists the current canonical workspace for its owner', async () => {
    const repository = createSampleWorkspaceRepository(true);
    await expect(showWorkspaceCommand(repository, SAMPLE_WORKSPACE_SCOPE)).resolves.toMatchObject({
      workspace: { id: SAMPLE_WORKSPACE_SCOPE.workspaceId },
      currentMembership: { userId: SAMPLE_OWNER_USER_ID },
    });
    const memberships = await listWorkspaceMembershipsCommand(repository, SAMPLE_WORKSPACE_SCOPE);
    expect(memberships).toHaveLength(2);
  });

  it('adds only an assistant and validates IDs and correlation values', async () => {
    const repository = createSampleWorkspaceRepository();
    const added = await addWorkspaceMembershipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      userId: ' assistant-a ',
      role: 'assistant',
      correlationId: 'request-add-a',
    });
    expect(added).toMatchObject({ userId: 'assistant-a', role: 'assistant', status: 'active' });
    await expect(addWorkspaceMembershipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      userId: 'owner-b',
      role: 'owner',
    })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(addWorkspaceMembershipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      userId: '../assistant',
    })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('rejects assistant authority for management and health', async () => {
    const repository = createSampleWorkspaceRepository(true);
    await expect(addWorkspaceMembershipCommand(repository, SAMPLE_ASSISTANT_SCOPE, {
      userId: 'assistant-b',
    })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(revokeWorkspaceMembershipCommand(repository, SAMPLE_ASSISTANT_SCOPE, {
      membershipId: SAMPLE_ASSISTANT_MEMBERSHIP_ID,
    })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(workspaceHealthCommand(repository, SAMPLE_ASSISTANT_SCOPE))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('revokes an assistant and returns redacted health to the owner', async () => {
    const repository = createSampleWorkspaceRepository(true);
    await expect(revokeWorkspaceMembershipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      membershipId: SAMPLE_ASSISTANT_MEMBERSHIP_ID,
      correlationId: 'request-revoke-a',
    })).resolves.toMatchObject({ status: 'revoked' });
    const health = await workspaceHealthCommand(repository, SAMPLE_WORKSPACE_SCOPE);
    expect(health).toMatchObject({ mode: 'sample', durable: false, status: 'healthy' });
    expect(JSON.stringify(health)).not.toContain(SAMPLE_OWNER_USER_ID);
  });
});
