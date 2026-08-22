'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  removeWorkspaceGeminiKey,
  setWorkspaceGeminiEnabled,
  validateAndSaveWorkspaceAiKey,
  validateAndSaveWorkspaceGeminiKey,
} from '@/lib/application/workspace-ai-settings';
import type { AiSettingsActionState } from '@/app/settings/action-state';

const WORKSPACE_AI_PROVIDERS = ['google-gemini', 'anthropic-claude'] as const;
const WORKSPACE_AI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] as const;

export async function toggleGeminiSettingsAction(
  _previous: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  try {
    const context = await getRepository();
    if (!context.isLive) throw new Error('A signed-in live workspace is required.');
    const enabled = formData.get('nextEnabled') === 'true';
    await setWorkspaceGeminiEnabled({
      authenticated: await createSupabaseServerClient(),
      scope: context.workspaceScope,
      expectedSecretVersion: expectedVersion(formData),
      enabled,
    });
    revalidatePath('/settings');
    return { status: 'success', message: `Gemini routing ${enabled ? 'enabled' : 'disabled'}.` };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Gemini routing state could not be changed.' };
  }
}

function expectedVersion(formData: FormData): number {
  const value = Number(formData.get('expectedSecretVersion'));
  if (!Number.isInteger(value) || value < 0) throw new Error('Configuration version is invalid. Reload the page.');
  return value;
}

export async function saveAiSettingsAction(
  _previous: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  try {
    const context = await getRepository();
    if (!context.isLive) throw new Error('A signed-in live workspace is required.');
    const selectedModel = String(formData.get('model') ?? '');
    const selectedProvider = String(formData.get('provider') ?? '');
    if (!WORKSPACE_AI_PROVIDERS.includes(selectedProvider as (typeof WORKSPACE_AI_PROVIDERS)[number])) {
      throw new Error('Select a supported AI provider.');
    }
    if (!WORKSPACE_AI_MODELS.includes(selectedModel as (typeof WORKSPACE_AI_MODELS)[number])) {
      throw new Error('Select a supported Gemini model.');
    }
    const common = {
      authenticated: await createSupabaseServerClient(),
      scope: context.workspaceScope,
      rawKey: formData.get('apiKey'),
      selectedModel,
      enabled: formData.get('enabled') === 'on',
      expectedSecretVersion: expectedVersion(formData),
    };
    if (selectedProvider === 'google-gemini') await validateAndSaveWorkspaceGeminiKey(common);
    else await validateAndSaveWorkspaceAiKey({ ...common, selectedProvider });
    revalidatePath('/settings');
    return { status: 'success', message: `${selectedProvider === 'anthropic-claude' ? 'Claude' : 'Gemini'} was validated and saved securely.` };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Gemini settings could not be saved.' };
  }
}

export async function saveGeminiSettingsAction(
  previous: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  if (!formData.has('provider')) formData.set('provider', 'google-gemini');
  return saveAiSettingsAction(previous, formData);
}

export async function removeGeminiSettingsAction(
  _previous: AiSettingsActionState,
  formData: FormData,
): Promise<AiSettingsActionState> {
  try {
    const context = await getRepository();
    if (!context.isLive) throw new Error('A signed-in live workspace is required.');
    await removeWorkspaceGeminiKey({
      authenticated: await createSupabaseServerClient(),
      scope: context.workspaceScope,
      expectedSecretVersion: expectedVersion(formData),
    });
    revalidatePath('/settings');
    return { status: 'success', message: 'Gemini key removed and Omnix conversational routing disabled.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Gemini key could not be removed.' };
  }
}
