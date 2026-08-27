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
import { generateOmnixNarrative } from '@/lib/application/omnix-generative-narrator';
import { loadWorkspaceAiRuntimeCredential } from '@/lib/application/workspace-ai-settings';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseOmnixAiBudgetAuthority } from '@/lib/application/omnix-ai-budget';
import { askOmnixCopilotAction, getOmnixAssistantProfileAction } from './actions';

vi.mock('@/lib/application/omnix-copilot-service', () => ({
  executeOmnixCopilot: vi.fn(),
}));
vi.mock('@/lib/application/omnix-gemini-router', () => ({
  routeOmnixQuestionWithGemini: vi.fn(),
}));
vi.mock('@/lib/application/omnix-generative-narrator', () => ({ generateOmnixNarrative: vi.fn() }));
vi.mock('@/lib/application/omnix-ai-budget', () => ({ createSupabaseOmnixAiBudgetAuthority: vi.fn(() => ({ reserve: vi.fn(), finalize: vi.fn() })) }));
vi.mock('@/lib/application/workspace-ai-settings', () => ({
  loadWorkspaceAiRuntimeCredential: vi.fn(),
}));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
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
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue(undefined);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(createSupabaseOmnixAiBudgetAuthority).mockReturnValue({
      reserve: vi.fn(async () => ({ allowed: true, reservationId: '63000000-0000-4000-8000-000000000001' })),
      finalize: vi.fn(async () => undefined),
    });
    vi.mocked(generateOmnixNarrative).mockResolvedValue({
      state: 'unconfigured', policyVersion: 'omnix-ai-policy.v1', reason: 'missing-credential',
      highlights: [], proposals: [], unknowns: [],
    });
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

  it('returns a concise set of friendly examples for inert unknown text', async () => {
    const result = await askOmnixCopilotAction('run arbitrary automation');

    expect(executeOmnixCopilot).not.toHaveBeenCalled();
    expect(result.status).toBe('unsupported');
    expect(result.answerBlocks[0]?.items.map((item) => item.label)).toEqual([
      'What are my priorities today?',
      'Who needs my attention?',
      'Which tasks are overdue?',
      'Show me my pipeline',
    ]);
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
    vi.mocked(getRepository).mockResolvedValue({ ...context, isLive: true } as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue({
      apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
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
    vi.mocked(generateOmnixNarrative).mockResolvedValue({
      state: 'available', policyVersion: 'omnix-ai-policy.v1', model: 'gemini-3.5-flash-lite',
      summary: { text: 'Pipeline is ready for review.', citationIds: ['citation-1'] },
      highlights: [], proposals: [], unknowns: [],
    });

    const result = await askOmnixCopilotAction('How healthy is my sales funnel?');

    expect(routeOmnixQuestionWithGemini).toHaveBeenCalledWith('How healthy is my sales funnel?', {
      credential: { apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' },
    });
    expect(vi.mocked(executeOmnixCopilot).mock.calls[0]?.[0].intent).toEqual({ kind: 'pipeline' });
    const authority = vi.mocked(createSupabaseOmnixAiBudgetAuthority).mock.results[0]?.value;
    expect(authority?.reserve).toHaveBeenCalledBefore(vi.mocked(routeOmnixQuestionWithGemini));
    expect(generateOmnixNarrative).toHaveBeenCalledWith(
      'How healthy is my sales funnel?',
      expect.any(Object),
      expect.objectContaining({ reservation: { reservationId: '63000000-0000-4000-8000-000000000001' } }),
    );
    expect(result.model).toMatchObject({
      state: 'available', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', routed: true, narrated: true,
    });
  });

  it('adds a grounded Gemini summary and governed proposal without executing it', async () => {
    const liveContext = { ...context, isLive: true } as Awaited<ReturnType<typeof getRepository>>;
    vi.mocked(getRepository).mockResolvedValue(liveContext);
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue({
      apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
    vi.mocked(executeOmnixCopilot).mockImplementation(async (request) => ({
      ok: true, schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION, command: 'ask',
      resolvedIntent: { kind: 'brief', date: 'today' }, correlationId: request.correlationId,
      dataMode: 'live', asOf: request.asOf, answerBlocks: [], citations: [], suggestions: [], warnings: [], alerts: [],
    }));
    vi.mocked(generateOmnixNarrative).mockResolvedValue({
      state: 'available', policyVersion: 'omnix-ai-policy.v1', model: 'gemini-3.5-flash-lite',
      summary: { text: 'Start with the overdue follow-up.', citationIds: ['citation-1'] },
      highlights: [], unknowns: [], proposals: [{
        kind: 'follow-up', title: 'Prepare a follow-up', text: 'Review the contact first.',
        preview: 'Call and confirm their current needs.', href: '/activities', citationIds: ['citation-1'],
      }],
    });

    const result = await askOmnixCopilotAction('What are my priorities today?');

    expect(result.model).toMatchObject({ state: 'available', narrated: true, policyVersion: 'omnix-ai-policy.v1' });
    expect(result.answerBlocks[0]).toMatchObject({ title: 'Omnix summary', detail: 'Start with the overdue follow-up.' });
    expect(result.suggestions[0]).toMatchObject({
      label: 'Prepare a follow-up', href: '/activities', commandPreview: 'Call and confirm their current needs.',
    });
    expect(result.suggestions[0]?.detail).toContain('preview only');
  });
});
