import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createMemoryWorkspaceRepository,
  sampleWorkspaceState,
} from '@/lib/data/memory-workspace-repository';
import {
  SAMPLE_ASSISTANT_SCOPE,
  SAMPLE_ASSISTANT_USER_ID,
  SAMPLE_OWNER_USER_ID,
  SAMPLE_WORKSPACE_SCOPE,
  type WorkspaceScope,
} from '@/lib/domain/workspace';
import {
  WORKSPACE_CLI_EXIT,
  createAuthenticatedLiveWorkspaceContext,
  runWorkspaceCli,
  type LiveWorkspaceConfiguration,
  type LiveWorkspaceContext,
  type WorkspaceCliCommand,
} from '../../scripts/manage-workspace';

const liveEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example',
  OMNIX_SUPABASE_ACCESS_TOKEN: 'end-user-access-token-do-not-print',
};

function outputHarness() {
  let stdout = '';
  let stderr = '';
  return {
    dependencies: {
      stdout: (value: string) => { stdout += value; },
      stderr: (value: string) => { stderr += value; },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function liveScope(scope: WorkspaceScope = SAMPLE_WORKSPACE_SCOPE): WorkspaceScope {
  return { ...scope, mode: 'live' };
}

function memoryLiveContext(scope = liveScope()): LiveWorkspaceContext {
  return {
    repository: createMemoryWorkspaceRepository({
      mode: 'live',
      durable: true,
      initialState: sampleWorkspaceState(true),
    }),
    authenticatedUserId: scope.authenticatedUserId,
    scope,
  };
}

describe('workspace CLI', () => {
  it('keeps default sample mode explicit and non-durable', async () => {
    const harness = outputHarness();
    const exit = await runWorkspaceCli(['health'], harness.dependencies);
    expect(exit).toBe(WORKSPACE_CLI_EXIT.success);
    expect(JSON.parse(harness.stdout())).toMatchObject({
      ok: true,
      mode: 'sample-process-only',
      durable: false,
      command: 'health',
      result: { mode: 'sample', durable: false },
    });
    expect(harness.stderr()).toBe('');
  });

  it('fails closed when live authenticated environment values are missing', async () => {
    const harness = outputHarness();
    const exit = await runWorkspaceCli(['show', '--live'], {
      ...harness.dependencies,
      env: { NODE_ENV: 'test' },
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.usage);
    expect(JSON.parse(harness.stderr())).toMatchObject({
      ok: false,
      mode: 'live-authenticated',
      code: 'invalid-input',
    });
  });

  it('refuses service-role keys and never echoes keys or access tokens', async () => {
    const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const serviceRole = `header.${payload}.signature`;
    const accessToken = 'sensitive-end-user-token';
    const harness = outputHarness();
    const exit = await runWorkspaceCli(['show', '--live'], {
      ...harness.dependencies,
      env: {
        NODE_ENV: 'test',
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: serviceRole,
        OMNIX_SUPABASE_ACCESS_TOKEN: accessToken,
      },
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.forbidden);
    expect(harness.stderr()).not.toContain(serviceRole);
    expect(harness.stderr()).not.toContain(accessToken);
    expect(JSON.parse(harness.stderr())).toMatchObject({ code: 'forbidden' });
  });

  it('runs live show through derived scope and redacts raw user identifiers', async () => {
    const harness = outputHarness();
    const liveContext = vi.fn(async (
      configuration: LiveWorkspaceConfiguration,
      command: WorkspaceCliCommand,
    ) => {
      expect(configuration.accessToken).toBe(liveEnv.OMNIX_SUPABASE_ACCESS_TOKEN);
      expect(command).toBe('show');
      return memoryLiveContext();
    });
    const exit = await runWorkspaceCli(['show', '--live'], {
      ...harness.dependencies,
      env: liveEnv,
      liveContext,
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.success);
    const raw = harness.stdout();
    expect(raw).not.toContain(SAMPLE_OWNER_USER_ID);
    expect(raw).not.toContain(SAMPLE_ASSISTANT_USER_ID);
    expect(raw).not.toContain(liveEnv.OMNIX_SUPABASE_ACCESS_TOKEN);
    expect(JSON.parse(raw)).toMatchObject({
      mode: 'live-authenticated',
      durable: true,
      result: {
        currentMembership: { userRef: expect.stringMatching(/^[0-9a-f]{12}$/) },
        scope: { role: 'owner', mode: 'live' },
      },
    });
    expect(liveContext).toHaveBeenCalledOnce();
  });

  it('redacts live membership lists and preserves the IDs needed for revocation', async () => {
    const harness = outputHarness();
    const exit = await runWorkspaceCli(['members', '--live'], {
      ...harness.dependencies,
      env: liveEnv,
      liveContext: async () => memoryLiveContext(),
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.success);
    const raw = harness.stdout();
    expect(raw).not.toContain(SAMPLE_OWNER_USER_ID);
    expect(raw).not.toContain(SAMPLE_ASSISTANT_USER_ID);
    const result = JSON.parse(raw).result as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result.every((membership) => (
      typeof membership.id === 'string'
      && typeof membership.userRef === 'string'
      && !('userId' in membership)
    ))).toBe(true);
  });

  it('validates live UUID mutation targets before opening a connection', async () => {
    const harness = outputHarness();
    const liveContext = vi.fn(async () => memoryLiveContext());
    const exit = await runWorkspaceCli(['add-member', '--user-id', '../spoof', '--live'], {
      ...harness.dependencies,
      env: liveEnv,
      liveContext,
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.usage);
    expect(liveContext).not.toHaveBeenCalled();
    expect(JSON.parse(harness.stderr())).toMatchObject({ code: 'invalid-input' });
  });

  it('keeps assistant membership mutations owner-only with redacted failures', async () => {
    const harness = outputHarness();
    const assistantScope = liveScope(SAMPLE_ASSISTANT_SCOPE);
    const exit = await runWorkspaceCli([
      'add-member',
      '--user-id',
      '11111111-1111-4111-8111-111111111111',
      '--live',
    ], {
      ...harness.dependencies,
      env: liveEnv,
      liveContext: async () => memoryLiveContext(assistantScope),
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.forbidden);
    expect(harness.stderr()).not.toContain(assistantScope.authenticatedUserId);
    expect(harness.stderr()).not.toContain(liveEnv.OMNIX_SUPABASE_ACCESS_TOKEN);
    expect(JSON.parse(harness.stderr())).toMatchObject({ code: 'forbidden' });
  });

  it('supports explicit live bootstrap without accepting caller-selected tenant scope', async () => {
    const harness = outputHarness();
    const authenticatedUserId = '11111111-1111-4111-8111-111111111111';
    const exit = await runWorkspaceCli(['bootstrap', '--name', 'Realtor team', '--live'], {
      ...harness.dependencies,
      env: liveEnv,
      liveContext: async () => ({
        repository: createMemoryWorkspaceRepository({ mode: 'live', durable: true }),
        authenticatedUserId,
      }),
    });
    expect(exit).toBe(WORKSPACE_CLI_EXIT.success);
    expect(harness.stdout()).not.toContain(authenticatedUserId);
    expect(JSON.parse(harness.stdout())).toMatchObject({
      result: {
        workspace: { name: 'Realtor team' },
        scope: { role: 'owner', mode: 'live' },
      },
    });
  });

  it('verifies the end-user token and resolves scope only after membership existence', async () => {
    const accessToken = 'verified-end-user-token';
    const eqCalls: Array<[string, unknown]> = [];
    const getUser = vi.fn(async (token: string) => {
      expect(token).toBe(accessToken);
      return {
        data: { user: { id: 'owner-a' } },
        error: null,
      };
    });
    const client = {
      auth: { getUser },
      from() {
        return {
          select() { return this; },
          eq(field: string, value: unknown) { eqCalls.push([field, value]); return this; },
          limit: async () => ({ data: [{ id: 'membership-owner-a' }], error: null }),
        };
      },
    } as unknown as SupabaseClient;
    const resolvedScope = liveScope();
    const resolveScope = vi.fn(async () => resolvedScope);
    const repository = createMemoryWorkspaceRepository({
      mode: 'live',
      durable: true,
      initialState: sampleWorkspaceState(true),
    });
    const result = await createAuthenticatedLiveWorkspaceContext(
      {
        url: 'https://example.supabase.co',
        anonKey: 'sb_publishable_example',
        accessToken,
      },
      'show',
      {
        client,
        resolveScope,
        repositoryFactory: () => repository,
      },
    );
    expect(getUser).toHaveBeenCalledWith(accessToken);
    expect(eqCalls).toEqual([
      ['user_id', 'owner-a'],
      ['status', 'active'],
    ]);
    expect(resolveScope).toHaveBeenCalledWith(client, 'owner-a');
    expect(result.scope).toEqual(resolvedScope);
  });

  it('does not implicitly bootstrap show when no active membership exists', async () => {
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'owner-a' } }, error: null }),
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          limit: async () => ({ data: [], error: null }),
        };
      },
    } as unknown as SupabaseClient;
    const resolveScope = vi.fn();
    await expect(createAuthenticatedLiveWorkspaceContext(
      {
        url: 'https://example.supabase.co',
        anonKey: 'sb_publishable_example',
        accessToken: 'end-user-token',
      },
      'show',
      { client, resolveScope },
    )).rejects.toMatchObject({ code: 'not-found' });
    expect(resolveScope).not.toHaveBeenCalled();
  });
});
