import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '@/lib/security/connector-secret-envelope';
import { routeOmnixQuestionWithGemini } from './omnix-gemini-router';
import {
  loadWorkspaceAiRuntimeCredential,
  readWorkspaceAiCapabilityStatus,
  readWorkspaceAiUsageStatus,
  loadWorkspaceGeminiCredential,
  validateAndSaveWorkspaceGeminiKey,
} from './workspace-ai-settings';

vi.mock('./omnix-gemini-router', () => ({ routeOmnixQuestionWithGemini: vi.fn() }));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: vi.fn() };
});

const rawKey = 'AIza-test-key-that-is-never-persisted-in-plaintext';
const liveScope: WorkspaceScope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' };

describe('workspace AI settings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OMNIX_CONNECTOR_KEK_ACTIVE_VERSION = 'test';
    process.env.OMNIX_CONNECTOR_KEK_test = Buffer.alloc(32, 7).toString('base64');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    vi.mocked(routeOmnixQuestionWithGemini).mockResolvedValue({
      state: 'available', model: 'gemini-3.5-flash-lite', query: 'pipeline',
    });
  });

  it('exposes only a safe capability projection to an active assistant', async () => {
    const assistantScope: WorkspaceScope = {
      ...liveScope,
      authenticatedUserId: 'assistant-user',
      membershipId: 'assistant-membership',
      role: 'assistant',
    };
    const membershipQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({
        data: { role: 'assistant', status: 'active' }, error: null,
      })),
    };
    membershipQuery.select.mockReturnValue(membershipQuery);
    membershipQuery.eq.mockReturnValue(membershipQuery);
    const configurationQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({
        data: {
          enabled: true,
          provider: 'google-gemini',
          model: 'gemini-3.5-flash-lite',
          secret_version: 1,
        },
        error: null,
      })),
    };
    configurationQuery.select.mockReturnValue(configurationQuery);
    configurationQuery.eq.mockReturnValue(configurationQuery);
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn((table: string) => table === 'workspace_members' ? membershipQuery : configurationQuery),
    } as never);

    await expect(readWorkspaceAiCapabilityStatus(assistantScope)).resolves.toEqual({
      state: 'available',
      provider: 'google-gemini',
      model: 'gemini-3.5-flash-lite',
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('validates, envelope-encrypts and persists no plaintext key', async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    const status = await validateAndSaveWorkspaceGeminiKey({
      authenticated: { rpc } as never,
      scope: liveScope,
      rawKey,
      selectedModel: 'gemini-3.5-flash-lite',
      enabled: true,
      expectedSecretVersion: 0,
      now: new Date('2026-08-14T12:00:00.000Z'),
    });
    expect(status).toMatchObject({ configured: true, enabled: true, secretVersion: 1 });
    expect(routeOmnixQuestionWithGemini).toHaveBeenCalledWith('How is my pipeline?', {
      credential: { apiKey: rawKey, model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' },
    });
    const rpcPayload = JSON.stringify(rpc.mock.calls[0]);
    expect(rpcPayload).not.toContain(rawKey);
    expect(rpcPayload).toContain('connector-secret-envelope.v1');
  });

  it('rejects assistants before validating or persisting a key', async () => {
    await expect(validateAndSaveWorkspaceGeminiKey({
      authenticated: { rpc: vi.fn() } as never,
      scope: { ...liveScope, role: 'assistant' },
      rawKey,
      selectedModel: 'gemini-3.5-flash-lite',
      enabled: true,
      expectedSecretVersion: 0,
    })).rejects.toThrow(/owner authority/i);
    expect(routeOmnixQuestionWithGemini).not.toHaveBeenCalled();
  });

  it('rejects support grants and forged owner roles before touching AI credentials', async () => {
    const rpc = vi.fn();
    await expect(validateAndSaveWorkspaceGeminiKey({
      authenticated: { rpc } as never,
      scope: {
        ...liveScope,
        authenticatedUserId: 'support-user',
        membershipId: 'support-membership',
        supportGrant: { active: true },
      },
      rawKey,
      selectedModel: 'gemini-3.5-flash-lite',
      enabled: true,
      expectedSecretVersion: 0,
    })).rejects.toThrow(/canonical workspace owner/i);
    expect(routeOmnixQuestionWithGemini).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('loads and decrypts an active workspace-bound credential only on the server', async () => {
    const envelope = encryptConnectorSecret(rawKey, {
      workspaceId: liveScope.workspaceId,
      connectionId: `workspace-ai-${liveScope.workspaceId}`,
      provider: 'google-gemini',
      secretType: 'gemini-api-key',
      recordVersion: 2,
    }, createEnvironmentKekResolver());
    vi.mocked(createClient).mockReturnValue({
      rpc: vi.fn(async () => ({ data: {
        enabled: true, model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private', secretVersion: 2, envelope,
      }, error: null })),
    } as never);

    await expect(loadWorkspaceGeminiCredential(liveScope)).resolves.toEqual({
      apiKey: rawKey, model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
  });

  it('allows an active assistant to use the server-side runtime credential without managing it', async () => {
    const assistantScope: WorkspaceScope = {
      ...liveScope,
      authenticatedUserId: 'assistant-user',
      membershipId: 'assistant-membership',
      role: 'assistant',
    };
    const envelope = encryptConnectorSecret(rawKey, {
      workspaceId: assistantScope.workspaceId,
      connectionId: `workspace-ai-${assistantScope.workspaceId}`,
      provider: 'google-gemini',
      secretType: 'gemini-api-key',
      recordVersion: 2,
    }, createEnvironmentKekResolver());
    const rpc = vi.fn(async () => ({ data: {
      enabled: true, provider: 'google-gemini', model: 'gemini-3.5-flash-lite',
      dataPolicy: 'paid-private', secretVersion: 2, envelope,
    }, error: null }));
    vi.mocked(createClient).mockReturnValue({ rpc } as never);

    await expect(loadWorkspaceAiRuntimeCredential(assistantScope)).resolves.toEqual({
      apiKey: rawKey, provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
    expect(rpc).toHaveBeenCalledWith('read_workspace_ai_runtime_envelope', {
      target_workspace_id: assistantScope.workspaceId,
      target_authenticated_user_id: assistantScope.authenticatedUserId,
      target_membership_id: assistantScope.membershipId,
    });
  });

  it('does not load workspace AI credentials for support administrators', async () => {
    await expect(loadWorkspaceGeminiCredential({
      ...liveScope,
      authenticatedUserId: 'support-user',
      membershipId: 'support-membership',
      role: 'assistant',
      supportGrant: { active: true },
    })).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns a redacted daily AI usage projection without reading generated content', async () => {
    const usageQuery = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({
        data: { usage_day: '2026-08-30', committed_microusd: 12500, run_count: 4 }, error: null,
      })),
    };
    usageQuery.select.mockReturnValue(usageQuery);
    usageQuery.eq.mockReturnValue(usageQuery);
    const runsQuery = {
      select: vi.fn(), eq: vi.fn(), gte: vi.fn(), order: vi.fn(), limit: vi.fn(async () => ({
        data: [
          { state: 'succeeded', created_at: '2026-08-30T15:00:00.000Z' },
          { state: 'failed', created_at: '2026-08-30T14:00:00.000Z' },
          { state: 'reserved', created_at: '2026-08-30T13:00:00.000Z' },
        ],
        error: null,
      })),
    };
    runsQuery.select.mockReturnValue(runsQuery);
    runsQuery.eq.mockReturnValue(runsQuery);
    runsQuery.gte.mockReturnValue(runsQuery);
    runsQuery.order.mockReturnValue(runsQuery);
    const client = {
      from: vi.fn((table: string) => table === 'omnix_ai_usage_windows' ? usageQuery : runsQuery),
    } as never;

    await expect(readWorkspaceAiUsageStatus(client, liveScope, new Date('2026-08-30T18:00:00.000Z'))).resolves.toEqual({
      usageDay: '2026-08-30',
      committedMicrousd: 12500,
      runCount: 4,
      succeeded: 1,
      failed: 1,
      reserved: 1,
      lastRunAt: '2026-08-30T15:00:00.000Z',
    });
    expect(usageQuery.select).toHaveBeenCalledWith('usage_day,committed_microusd,run_count');
    expect(runsQuery.select).toHaveBeenCalledWith('state,created_at');
  });

  it('hides AI usage when the protected migration is unavailable', async () => {
    const missingQuery = {
      select: vi.fn(), eq: vi.fn(), gte: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
    };
    missingQuery.select.mockReturnValue(missingQuery);
    missingQuery.eq.mockReturnValue(missingQuery);
    missingQuery.gte.mockReturnValue(missingQuery);
    missingQuery.order.mockReturnValue(missingQuery);
    missingQuery.limit.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } });
    missingQuery.maybeSingle.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } });

    await expect(readWorkspaceAiUsageStatus({ from: vi.fn(() => missingQuery) } as never, liveScope)).resolves.toBeUndefined();
  });
});
