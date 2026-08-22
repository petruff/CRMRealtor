import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { validateAndSaveWorkspaceGeminiKey } from '@/lib/application/workspace-ai-settings';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { INITIAL_AI_SETTINGS_ACTION_STATE } from './action-state';
import { saveGeminiSettingsAction } from './actions';

vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/application/workspace-ai-settings', () => ({
  WORKSPACE_AI_MODELS: ['gemini-3.5-flash-lite', 'gemini-3.6-flash'],
  validateAndSaveWorkspaceGeminiKey: vi.fn(),
  removeWorkspaceGeminiKey: vi.fn(),
  setWorkspaceGeminiEnabled: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

describe('Gemini settings actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true, workspaceScope: { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' },
    } as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(validateAndSaveWorkspaceGeminiKey).mockResolvedValue({
      configured: true, enabled: true, model: 'gemini-3.5-flash-lite', secretVersion: 1,
    });
  });

  it('returns sanitized success state and never echoes the submitted key', async () => {
    const form = new FormData();
    form.set('apiKey', 'AIza-a-secret-that-must-not-return-to-the-browser');
    form.set('model', 'gemini-3.5-flash-lite');
    form.set('enabled', 'on');
    form.set('expectedSecretVersion', '0');
    const result = await saveGeminiSettingsAction(INITIAL_AI_SETTINGS_ACTION_STATE, form);
    expect(result).toEqual({ status: 'success', message: 'Gemini was validated and saved securely.' });
    expect(JSON.stringify(result)).not.toContain('AIza');
  });
});
