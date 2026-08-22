import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { sha256Hex } from '../domain/connector.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorSecretEnvelope,
} from '../security/connector-secret-envelope.ts';
import { routeOmnixQuestionWithGemini } from './omnix-gemini-router.ts';
import { routeOmnixQuestionWithClaude } from './omnix-claude-router.ts';

export const WORKSPACE_AI_PROVIDERS = ['google-gemini', 'anthropic-claude'] as const;
export type WorkspaceAiProvider = (typeof WORKSPACE_AI_PROVIDERS)[number];
export const WORKSPACE_AI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'] as const;
export type WorkspaceAiModel = (typeof WORKSPACE_AI_MODELS)[number];

export interface WorkspaceAiStatus {
  readonly configured: boolean;
  readonly provider?: WorkspaceAiProvider;
  readonly enabled: boolean;
  readonly model: WorkspaceAiModel;
  readonly secretVersion: number;
  readonly keyFingerprint?: string;
  readonly configuredAt?: string;
  readonly updatedAt?: string;
}

export interface WorkspaceAiCredential {
  readonly apiKey: string;
  readonly provider: WorkspaceAiProvider;
  readonly model: WorkspaceAiModel;
  readonly dataPolicy: 'paid-private';
}

type ConfigurationRow = {
  provider: string;
  model: string;
  enabled: boolean;
  secret_version: number | null;
  key_fingerprint: string | null;
  configured_at: string | null;
  updated_at: string;
};

function model(value: unknown): WorkspaceAiModel {
  if (!WORKSPACE_AI_MODELS.includes(value as WorkspaceAiModel)) throw new Error('Unsupported AI model.');
  return value as WorkspaceAiModel;
}

function apiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('AI API key is required.');
  const normalized = value.trim();
  if (normalized.length < 20 || normalized.length > 256 || /[\s\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('AI API key format is invalid.');
  }
  return normalized;
}

function provider(value: unknown): WorkspaceAiProvider {
  if (!WORKSPACE_AI_PROVIDERS.includes(value as WorkspaceAiProvider)) throw new Error('Unsupported AI provider.');
  return value as WorkspaceAiProvider;
}

function assertProviderModel(selectedProvider: WorkspaceAiProvider, selectedModel: WorkspaceAiModel) {
  if (selectedProvider === 'google-gemini' && !selectedModel.startsWith('gemini-')) throw new Error('Select a Gemini model.');
  if (selectedProvider === 'anthropic-claude' && !selectedModel.startsWith('claude-')) throw new Error('Select a Claude model.');
}

function aad(scope: WorkspaceScope, version: number, selectedProvider: WorkspaceAiProvider) {
  return {
    workspaceId: scope.workspaceId,
    connectionId: `workspace-ai-${scope.workspaceId}`,
    provider: selectedProvider,
    secretType: selectedProvider === 'google-gemini' ? 'gemini-api-key' : 'claude-api-key',
    recordVersion: version,
  } as const;
}

export async function readWorkspaceAiStatus(
  authenticated: SupabaseClient,
  scope: WorkspaceScope,
): Promise<WorkspaceAiStatus> {
  const { data, error } = await authenticated.from('workspace_ai_configurations')
    .select('provider,model,enabled,secret_version,key_fingerprint,configured_at,updated_at')
    .eq('workspace_id', scope.workspaceId)
    .maybeSingle();
  if (error) throw new Error('Workspace AI settings are unavailable. Apply migration 0024.');
  if (!data) return { configured: false, enabled: false, provider: 'google-gemini', model: 'gemini-3.5-flash-lite', secretVersion: 0 };
  const row = data as ConfigurationRow;
  return {
    configured: Boolean(row.secret_version),
    provider: provider(row.provider),
    enabled: row.enabled,
    model: model(row.model),
    secretVersion: row.secret_version ?? 0,
    ...(row.key_fingerprint ? { keyFingerprint: row.key_fingerprint } : {}),
    ...(row.configured_at ? { configuredAt: row.configured_at } : {}),
    updatedAt: row.updated_at,
  };
}

export async function validateAndSaveWorkspaceAiKey(input: {
  readonly authenticated: SupabaseClient;
  readonly scope: WorkspaceScope;
  readonly rawKey: unknown;
  readonly selectedModel: unknown;
  readonly selectedProvider: unknown;
  readonly enabled: boolean;
  readonly expectedSecretVersion: number;
  readonly now?: Date;
}): Promise<WorkspaceAiStatus> {
  if (input.scope.role !== 'owner') throw new Error('Workspace owner authority is required.');
  const selectedModel = model(input.selectedModel);
  const selectedProvider = provider(input.selectedProvider);
  assertProviderModel(selectedProvider, selectedModel);
  const key = apiKey(input.rawKey);
  const credential = { apiKey: key, model: selectedModel, dataPolicy: 'paid-private' as const };
  const probe = selectedProvider === 'google-gemini'
    ? await routeOmnixQuestionWithGemini('Como está meu pipeline?', {
      credential,
    })
    : await routeOmnixQuestionWithClaude('Como está meu pipeline?', {
      credential,
    });
  if (probe.state !== 'available' || probe.query !== 'pipeline') {
    throw new Error('The provider rejected the key or the selected model is unavailable.');
  }
  const nextVersion = input.expectedSecretVersion + 1;
  const envelope = encryptConnectorSecret(key, aad(input.scope, nextVersion, selectedProvider), createEnvironmentKekResolver());
  const occurredAt = (input.now ?? new Date()).toISOString();
  const { error } = await input.authenticated.rpc('save_workspace_ai_configuration_v2', {
    target_workspace_id: input.scope.workspaceId,
    target_provider: selectedProvider,
    target_model: selectedModel,
    target_enabled: input.enabled,
    target_key_fingerprint: sha256Hex(key).slice(0, 12),
    target_expected_secret_version: input.expectedSecretVersion,
    target_secret_envelope: envelope,
    target_occurred_at: occurredAt,
  });
  if (error) throw new Error(error.code === '40001' ? 'Settings changed in another session. Reload and try again.' : 'AI settings could not be saved.');
  return {
    configured: true,
    provider: selectedProvider,
    enabled: input.enabled,
    model: selectedModel,
    secretVersion: nextVersion,
    keyFingerprint: sha256Hex(key).slice(0, 12),
    configuredAt: occurredAt,
    updatedAt: occurredAt,
  };
}

export async function validateAndSaveWorkspaceGeminiKey(input: Omit<Parameters<typeof validateAndSaveWorkspaceAiKey>[0], 'selectedProvider'>) {
  return validateAndSaveWorkspaceAiKey({ ...input, selectedProvider: 'google-gemini' });
}

export async function removeWorkspaceGeminiKey(input: {
  readonly authenticated: SupabaseClient;
  readonly scope: WorkspaceScope;
  readonly expectedSecretVersion: number;
}): Promise<void> {
  if (input.scope.role !== 'owner') throw new Error('Workspace owner authority is required.');
  const { error } = await input.authenticated.rpc('remove_workspace_ai_configuration', {
    target_workspace_id: input.scope.workspaceId,
    target_expected_secret_version: input.expectedSecretVersion,
    target_occurred_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.code === '40001' ? 'Settings changed in another session. Reload and try again.' : 'Gemini key could not be removed.');
}

export async function setWorkspaceGeminiEnabled(input: {
  readonly authenticated: SupabaseClient;
  readonly scope: WorkspaceScope;
  readonly expectedSecretVersion: number;
  readonly enabled: boolean;
}): Promise<void> {
  if (input.scope.role !== 'owner') throw new Error('Workspace owner authority is required.');
  const { error } = await input.authenticated.rpc('set_workspace_ai_enabled', {
    target_workspace_id: input.scope.workspaceId,
    target_expected_secret_version: input.expectedSecretVersion,
    target_enabled: input.enabled,
    target_occurred_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.code === '40001' ? 'Settings changed in another session. Reload and try again.' : 'Gemini routing state could not be changed.');
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('Workspace AI service authority is unavailable.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function loadWorkspaceAiCredential(scope: WorkspaceScope): Promise<WorkspaceAiCredential | undefined> {
  if (scope.mode !== 'live') return undefined;
  const { data, error } = await serviceClient().rpc('read_workspace_ai_secret_envelope', {
    target_workspace_id: scope.workspaceId,
    target_authenticated_user_id: scope.authenticatedUserId,
    target_membership_id: scope.membershipId,
  });
  if (error || !data) return undefined;
  const record = data as {
    enabled?: unknown; provider?: unknown; model?: unknown; dataPolicy?: unknown; secretVersion?: unknown; envelope?: unknown;
  };
  if (record.enabled !== true || record.dataPolicy !== 'paid-private'
    || !Number.isInteger(record.secretVersion) || Number(record.secretVersion) < 1) return undefined;
  const selectedModel = model(record.model);
  const selectedProvider = provider(record.provider ?? 'google-gemini');
  assertProviderModel(selectedProvider, selectedModel);
  const version = Number(record.secretVersion);
  const key = decryptConnectorSecret(
    record.envelope as ConnectorSecretEnvelope,
    aad(scope, version, selectedProvider),
    createEnvironmentKekResolver(),
  );
  return { apiKey: key, provider: selectedProvider, model: selectedModel, dataPolicy: 'paid-private' };
}

export async function loadWorkspaceGeminiCredential(scope: WorkspaceScope) {
  const credential = await loadWorkspaceAiCredential(scope);
  if (credential?.provider !== 'google-gemini') return undefined;
  return { apiKey: credential.apiKey, model: credential.model, dataPolicy: credential.dataPolicy };
}
