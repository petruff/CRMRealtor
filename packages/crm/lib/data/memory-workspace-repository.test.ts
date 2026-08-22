import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ASSISTANT_MEMBERSHIP_ID,
  SAMPLE_ASSISTANT_SCOPE,
  SAMPLE_OWNER_MEMBERSHIP_ID,
  SAMPLE_OWNER_USER_ID,
  SAMPLE_WORKSPACE_SCOPE,
} from '@/lib/domain/workspace';
import {
  createMemoryWorkspaceRepository,
  createSampleWorkspaceRepository,
} from './memory-workspace-repository';

function deterministicRepository() {
  let sequence = 0;
  return createMemoryWorkspaceRepository({
    mode: 'sample',
    clock: () => new Date('2026-08-11T12:00:00.000Z'),
    idFactory: (kind) => `${kind}-${sequence += 1}`,
  });
}

describe('memory workspace repository', () => {
  it('bootstraps one canonical owner scope and rejects duplicate active bootstrap', async () => {
    const repository = deterministicRepository();
    const authority = await repository.bootstrapOwner({
      authenticatedUserId: 'owner-a',
      name: '  Realty A  ',
      mode: 'sample',
      correlationId: 'request-bootstrap-a',
    });

    expect(authority).toMatchObject({
      durable: false,
      workspace: { name: 'Realty A' },
      currentMembership: { userId: 'owner-a', role: 'owner', status: 'active' },
      scope: {
        authenticatedUserId: 'owner-a',
        ownerUserId: 'owner-a',
        role: 'owner',
        mode: 'sample',
      },
    });
    await expect(repository.bootstrapOwner({
      authenticatedUserId: 'owner-a',
      name: 'Another workspace',
      mode: 'sample',
    })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets an owner add and revoke an assistant while retaining audit identity', async () => {
    const repository = createSampleWorkspaceRepository();
    const assistant = await repository.addMembership(SAMPLE_WORKSPACE_SCOPE, {
      userId: 'assistant-a',
      role: 'assistant',
      correlationId: 'request-add-a',
    });
    const assistantScope = {
      ...SAMPLE_ASSISTANT_SCOPE,
      authenticatedUserId: assistant.userId,
      membershipId: assistant.id,
    };

    await expect(repository.show(assistantScope)).resolves.toMatchObject({
      currentMembership: { id: assistant.id, status: 'active' },
    });
    await expect(repository.listMemberships(assistantScope)).rejects.toMatchObject({ code: 'forbidden' });

    const revoked = await repository.revokeMembership(SAMPLE_WORKSPACE_SCOPE, {
      membershipId: assistant.id,
      correlationId: 'request-revoke-a',
    });
    expect(revoked).toMatchObject({ status: 'revoked', userId: 'assistant-a' });
    await expect(repository.show(assistantScope)).rejects.toMatchObject({ code: 'revoked-membership' });

    const events = await repository.listAuthorityAuditEvents(SAMPLE_WORKSPACE_SCOPE);
    expect(events.map((event) => ({
      actorUserId: event.actorUserId,
      action: event.action,
      result: event.result,
      correlationId: event.correlationId,
    }))).toEqual([
      {
        actorUserId: SAMPLE_OWNER_USER_ID,
        action: 'membership.add',
        result: 'succeeded',
        correlationId: 'request-add-a',
      },
      {
        actorUserId: SAMPLE_OWNER_USER_ID,
        action: 'membership.revoke',
        result: 'succeeded',
        correlationId: 'request-revoke-a',
      },
    ]);
  });

  it('rejects multiple owners, duplicate active membership, and owner revocation', async () => {
    const repository = createSampleWorkspaceRepository();
    await expect(repository.addMembership(SAMPLE_WORKSPACE_SCOPE, {
      userId: 'owner-b',
      role: 'owner',
    })).rejects.toMatchObject({ code: 'invalid-input' });

    await repository.addMembership(SAMPLE_WORKSPACE_SCOPE, {
      userId: 'assistant-a',
      role: 'assistant',
    });
    await expect(repository.addMembership(SAMPLE_WORKSPACE_SCOPE, {
      userId: 'assistant-a',
      role: 'assistant',
    })).rejects.toMatchObject({ code: 'conflict' });
    await expect(repository.revokeMembership(SAMPLE_WORKSPACE_SCOPE, {
      membershipId: SAMPLE_OWNER_MEMBERSHIP_ID,
    })).rejects.toMatchObject({ code: 'invariant-violation' });
  });

  it('fails closed for spoofed workspace, actor, role, owner alias, and mode', async () => {
    const repository = createSampleWorkspaceRepository(true);
    const spoofs = [
      { ...SAMPLE_WORKSPACE_SCOPE, workspaceId: 'workspace-b' },
      { ...SAMPLE_WORKSPACE_SCOPE, authenticatedUserId: 'owner-b' },
      { ...SAMPLE_WORKSPACE_SCOPE, role: 'assistant' as const },
      { ...SAMPLE_WORKSPACE_SCOPE, ownerUserId: 'owner-b' },
      { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' as const },
    ];
    for (const scope of spoofs) {
      await expect(repository.show(scope)).rejects.toBeDefined();
    }

    await expect(repository.revokeMembership(SAMPLE_WORKSPACE_SCOPE, {
      membershipId: 'membership-workspace-b',
    })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('revokes only the selected workspace membership and supports a later re-add', async () => {
    const repository = createSampleWorkspaceRepository(true);
    await repository.revokeMembership(SAMPLE_WORKSPACE_SCOPE, {
      membershipId: SAMPLE_ASSISTANT_MEMBERSHIP_ID,
    });
    const replacement = await repository.addMembership(SAMPLE_WORKSPACE_SCOPE, {
      userId: SAMPLE_ASSISTANT_SCOPE.authenticatedUserId,
      role: 'assistant',
    });
    expect(replacement.id).not.toBe(SAMPLE_ASSISTANT_MEMBERSHIP_ID);
    const active = (await repository.listMemberships(SAMPLE_WORKSPACE_SCOPE))
      .filter((membership) => membership.status === 'active');
    expect(active).toHaveLength(2);
  });

  it('returns owner-only redacted health with truthful sample durability', async () => {
    const repository = createSampleWorkspaceRepository(true);
    const health = await repository.health(SAMPLE_WORKSPACE_SCOPE);
    expect(health).toMatchObject({
      schemaVersion: 'workspace-health.v1',
      mode: 'sample',
      durable: false,
      status: 'healthy',
    });
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(SAMPLE_OWNER_USER_ID);
    expect(serialized).not.toContain(SAMPLE_ASSISTANT_SCOPE.authenticatedUserId);
    expect(serialized).not.toMatch(/service.role|token|secret|@/i);
    await expect(repository.health(SAMPLE_ASSISTANT_SCOPE)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('does not leak mutable repository state through returned objects', async () => {
    const repository = createSampleWorkspaceRepository();
    const shown = await repository.show(SAMPLE_WORKSPACE_SCOPE);
    (shown.workspace as { name: string }).name = 'Mutated outside';
    const listed = await repository.listMemberships(SAMPLE_WORKSPACE_SCOPE);
    (listed[0] as { userId: string }).userId = 'spoofed';
    await expect(repository.show(SAMPLE_WORKSPACE_SCOPE)).resolves.toMatchObject({
      workspace: { name: 'Omnix Sample Workspace' },
      currentMembership: { userId: SAMPLE_OWNER_USER_ID },
    });
  });
});
