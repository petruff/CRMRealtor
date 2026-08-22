import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  resolveSupabaseWorkspaceScope: vi.fn(),
}));

vi.mock('@/lib/supabase/env', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock('./supabase-workspace-scope', async () => {
  const actual = await vi.importActual<typeof import('./supabase-workspace-scope')>(
    './supabase-workspace-scope',
  );
  return {
    ...actual,
    resolveSupabaseWorkspaceScope: mocks.resolveSupabaseWorkspaceScope,
  };
});

import { getRepository, resolveUserDisplayName } from './index';

const liveScope: WorkspaceScope = {
  authenticatedUserId: 'owner-live',
  ownerUserId: 'owner-live',
  membershipId: 'membership-live',
  workspaceId: 'workspace-live',
  role: 'owner',
  mode: 'live',
};

describe('getRepository workspace context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves canonical person identity before trusted auth metadata and email fallback', () => {
    const user = {
      email: 'paulo.petruff@example.test',
      user_metadata: { full_name: 'Paulo Petruff', name: 'Ignored Name' },
    };
    expect(resolveUserDisplayName(user, ' Judith  Serna ')).toBe('Judith Serna');
    expect(resolveUserDisplayName(user)).toBe('Paulo Petruff');
    expect(resolveUserDisplayName({ email: 'judith.serna@example.test', user_metadata: {} })).toBe('Judith Serna');
    expect(resolveUserDisplayName({ email: null, user_metadata: { full_name: '\u0000  ' } })).toBeUndefined();
    expect(resolveUserDisplayName({ email: null, user_metadata: { display_name: `  ${'A'.repeat(140)}  ` } }))
      .toHaveLength(120);
  });

  it('returns the explicit sample scope and non-durable workspace repository when unconfigured', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    const context = await getRepository();
    expect(context).toMatchObject({
      isLive: false,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    });
    expect(context).toEqual(expect.objectContaining({
      smartListRepository: expect.any(Object),
      incompleteRecordRepository: expect.any(Object),
      activityRepository: expect.any(Object),
      richContactRepository: expect.any(Object),
    }));
    await expect(context.workspaceRepository.show(context.workspaceScope)).resolves.toMatchObject({
      durable: false,
      scope: SAMPLE_WORKSPACE_SCOPE,
    });
    const nextRequest = await getRepository();
    expect(nextRequest.smartListRepository).toBe(context.smartListRepository);
    expect(nextRequest.incompleteRecordRepository).toBe(context.incompleteRecordRepository);
    expect(nextRequest.activityRepository).toBe(context.activityRepository);
    expect(nextRequest.richContactRepository).toBe(context.richContactRepository);
  });

  it('resolves required live authority before constructing live repositories', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'owner-live', email: 'owner@example.test', user_metadata: { full_name: 'Judith Serna' } } },
        }),
      },
    };
    mocks.createSupabaseServerClient.mockResolvedValue(client);
    mocks.resolveSupabaseWorkspaceScope.mockResolvedValue(liveScope);

    const context = await getRepository();
    expect(mocks.resolveSupabaseWorkspaceScope).toHaveBeenCalledWith(client, 'owner-live', {
      selectedWorkspaceId: undefined,
    });
    expect(context).toMatchObject({
      isLive: true,
      userEmail: 'owner@example.test',
      userDisplayName: 'Judith Serna',
      workspaceScope: liveScope,
    });
    expect(context.workspaceRepository).toBeDefined();
    expect(context.smartListRepository).toBeDefined();
    expect(context.incompleteRecordRepository).toBeDefined();
    expect(context.activityRepository).toBeDefined();
    expect(context.richContactRepository).toBeDefined();
  });

  it('keeps configured but anonymous rendering in explicit sample mode', async () => {
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const context = await getRepository();
    expect(context.isLive).toBe(false);
    expect(context.workspaceScope).toEqual(SAMPLE_WORKSPACE_SCOPE);
    expect(context.smartListRepository).toBeDefined();
    expect(context.incompleteRecordRepository).toBeDefined();
    expect(context.activityRepository).toBeDefined();
    expect(mocks.resolveSupabaseWorkspaceScope).not.toHaveBeenCalled();
  });
});
