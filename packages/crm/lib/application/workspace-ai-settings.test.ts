import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '@/lib/security/connector-secret-envelope';
import { routeOmnixQuestionWithGemini } from './omnix-gemini-router';
import {
  loadWorkspaceGeminiCredential,
  validateAndSaveWorkspaceGeminiKey,
} from './workspace-ai-settings';

vi.mock('server-only', () => ({}));
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
});
