import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeOmnixCopilot } from '@/lib/application/omnix-copilot-service';
import { getRepository } from '@/lib/data';
import {
  OMNIX_COPILOT_SCHEMA_VERSION,
  type OmnixCopilotSuccessResponse,
} from '@/lib/domain/omnix-copilot';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { emitOmnixCopilotTelemetry } from '@/lib/observability/omnix-copilot-telemetry';
import { routeOmnixQuestionWithGemini } from '@/lib/application/omnix-gemini-router';
import { loadWorkspaceGeminiCredential } from '@/lib/application/workspace-ai-settings';
import { askOmnixCopilotAction, getOmnixAssistantProfileAction } from './actions';

vi.mock('@/lib/application/omnix-copilot-service', () => ({
  executeOmnixCopilot: vi.fn(),
}));
vi.mock('@/lib/application/omnix-gemini-router', () => ({
  routeOmnixQuestionWithGemini: vi.fn(),
}));
vi.mock('@/lib/application/workspace-ai-settings', () => ({
  loadWorkspaceGeminiCredential: vi.fn(),
}));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/observability/omnix-copilot-telemetry', () => ({
  defaultOmnixCopilotTelemetrySink: vi.fn(),
  emitOmnixCopilotTelemetry: vi.fn(),
  omnixCopilotTelemetryErrorCategory: vi.fn((error: unknown) => (
    error && typeof error === 'object' && 'code' in error && error.code === 'unsupported-intent'
      ? 'unsupported-intent'
      : 'internal-error'
  )),
}));

describe('askOmnixCopilotAction', () => {
  const context = {
    isLive: false,
    workspaceScope: SAMPLE_WORKSPACE_SCOPE,
  } as Awaited<ReturnType<typeof getRepository>>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    vi.mocked(getRepository).mockResolvedValue(context);
    vi.mocked(routeOmnixQuestionWithGemini).mockResolvedValue({ state: 'unconfigured', reason: 'disabled' });
    vi.mocked(loadWorkspaceGeminiCredential).mockResolvedValue(undefined);
  });

  it('returns only a canonical first name for the global assistant greeting', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      ...context,
      isLive: true,
      userEmail: 'judith@example.com',
      userDisplayName: '  Judith   Serna  ',
    });

    await expect(getOmnixAssistantProfileAction()).resolves.toEqual({
      available: true,
      firstName: 'Judith',
      dataMode: 'live',
    });
  });

  it('does not expose an email fallback when a profile name is unavailable', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      ...context,
      isLive: true,
      userEmail: 'judith@example.com',
    });

    await expect(getOmnixAssistantProfileAction()).resolves.toEqual({
      available: true,
      dataMode: 'live',
    });
  });

  it('uses the shared service and maps its evidence without adding a write path', async () => {
    vi.mocked(executeOmnixCopilot).mockImplementation(async (request) => ({
      ok: true,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask',
      resolvedIntent: { kind: 'pipeline' },
      correlationId: request.correlationId,
      dataMode: request.dataMode,
      asOf: request.asOf,
      answerBlocks: [],
      citations: [],
      suggestions: [],
      warnings: [],
      alerts: [],
    } satisfies OmnixCopilotSuccessResponse));

    const result = await askOmnixCopilotAction('show pipeline');

    expect(executeOmnixCopilot).toHaveBeenCalledOnce();
    expect(vi.mocked(executeOmnixCopilot).mock.calls[0]?.[0]).toMatchObject({
      command: 'ask',
      intent: { kind: 'pipeline' },
      dataMode: 'sample',
    });
    expect(result).toMatchObject({ status: 'success', intent: 'pipeline', dataMode: 'sample' });
  });

  it('returns the documented supported examples for inert unknown text', async () => {
    const result = await askOmnixCopilotAction('run arbitrary automation');

    expect(executeOmnixCopilot).not.toHaveBeenCalled();
    expect(result.status).toBe('unsupported');
    expect(result.answerBlocks[0]?.items.length).toBeGreaterThan(5);
    expect(emitOmnixCopilotTelemetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        resolvedIntent: 'unresolved',
        outcome: 'failure',
        errorCategory: 'unsupported-intent',
      }),
    );
    expect(vi.mocked(emitOmnixCopilotTelemetry).mock.calls[0]?.[1]).not.toHaveProperty('question');
  });

  it('uses Gemini only to route unsupported language into the deterministic executor', async () => {
    vi.mocked(loadWorkspaceGeminiCredential).mockResolvedValue({
      apiKey: 'stored-server-key', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
    vi.mocked(routeOmnixQuestionWithGemini).mockResolvedValue({
      state: 'available', model: 'gemini-3.5-flash-lite', query: 'pipeline',
    });
    vi.mocked(executeOmnixCopilot).mockImplementation(async (request) => ({
      ok: true,
      schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION,
      command: 'ask',
      resolvedIntent: { kind: 'pipeline' },
      correlationId: request.correlationId,
      dataMode: request.dataMode,
      asOf: request.asOf,
      answerBlocks: [], citations: [], suggestions: [], warnings: [], alerts: [],
    }));

    const result = await askOmnixCopilotAction('Como está meu funil?');

    expect(routeOmnixQuestionWithGemini).toHaveBeenCalledWith('Como está meu funil?', {
      credential: { apiKey: 'stored-server-key', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' },
    });
    expect(vi.mocked(executeOmnixCopilot).mock.calls[0]?.[0].intent).toEqual({ kind: 'pipeline' });
    expect(result.model).toEqual({
      state: 'available', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', routed: true,
    });
  });
});
