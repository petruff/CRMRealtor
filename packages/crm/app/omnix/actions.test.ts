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
import { researchWithGemini } from '@/lib/application/omnix-gemini-research';
import { askOmnixCopilotAction, getOmnixAssistantProfileAction } from './actions';
import { createMemoryOmnixProposalRepository } from '@/lib/data/memory-omnix-proposal-repository';

vi.mock('@/lib/application/omnix-copilot-service', () => ({
  executeOmnixCopilot: vi.fn(),
}));
vi.mock('@/lib/application/omnix-gemini-router', () => ({
  routeOmnixQuestionWithGemini: vi.fn(),
}));
vi.mock('@/lib/application/omnix-generative-narrator', () => ({ generateOmnixNarrative: vi.fn() }));
vi.mock('@/lib/application/omnix-gemini-research', () => ({ researchWithGemini: vi.fn() }));
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
    repository: { list: vi.fn(async () => []) },
    omnixProposalRepository: createMemoryOmnixProposalRepository(),
  } as unknown as Awaited<ReturnType<typeof getRepository>>;

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
    vi.mocked(researchWithGemini).mockResolvedValue({
      state: 'limited', policyVersion: 'omnix-ai-policy.v1', reason: 'sources-unavailable',
      sources: [], searchQueries: [], warnings: [],
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

  it('researches only an explicitly public question with a valid public route', async () => {
    vi.mocked(getRepository).mockResolvedValue({ ...context, isLive: true } as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue({
      apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
    vi.mocked(routeOmnixQuestionWithGemini).mockResolvedValue({
      state: 'available', route: 'public-web', model: 'gemini-3.5-flash-lite', inputTokens: 30, outputTokens: 2,
    });
    vi.mocked(researchWithGemini).mockResolvedValue({
      state: 'available', policyVersion: 'omnix-ai-policy.v1', model: 'gemini-3.5-flash-lite',
      answer: 'Florida market conditions vary by county and property type.',
      sources: [{ id: 'web-source-1', title: 'Florida Realtors', url: 'https://www.floridarealtors.org/research' }],
      searchQueries: ['Florida real estate market'], warnings: [],
    });

    const result = await askOmnixCopilotAction('Research current Florida real estate market conditions', { source: 'public-web' });

    expect(executeOmnixCopilot).not.toHaveBeenCalled();
    expect(researchWithGemini).toHaveBeenCalledWith(
      'Research current Florida real estate market conditions',
      expect.any(String),
      expect.objectContaining({
        credential: expect.objectContaining({ apiKey: 'stored-server-key' }),
        reservation: { reservationId: '63000000-0000-4000-8000-000000000001' },
        priorInputTokens: 30,
        priorOutputTokens: 2,
      }),
    );
    expect(result).toMatchObject({
      status: 'success',
      intent: 'web-research',
      answerBlocks: [{ title: 'Research answer' }],
      citations: [{ entityType: 'web', target: 'https://www.floridarealtors.org/research' }],
      model: { researched: true, provider: 'google-gemini' },
    });
  });

  it('never turns failed or ambiguous CRM routing into public research and finalizes its reservation', async () => {
    vi.mocked(getRepository).mockResolvedValue({ ...context, isLive: true });
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue({
      apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
    for (const route of [
      { state: 'failed' as const, reason: 'invalid-response' as const },
      { state: 'available' as const, route: 'clarify' as const },
      { state: 'available' as const, route: 'public-web' as const, query: 'Research my client Alicia' },
    ]) {
      vi.mocked(routeOmnixQuestionWithGemini).mockResolvedValue(route);
      const answer = await askOmnixCopilotAction('Research my client Alicia');
      expect(answer.status).toBe('unsupported');
    }
    expect(researchWithGemini).not.toHaveBeenCalled();
    expect(executeOmnixCopilot).not.toHaveBeenCalled();
    expect(generateOmnixNarrative).not.toHaveBeenCalled();
    expect(vi.mocked(createSupabaseOmnixAiBudgetAuthority).mock.results[0]?.value.finalize).toHaveBeenCalledTimes(3);
  });

  it('rejects private web requests before loading credentials or dispatching tools', async () => {
    const answer = await askOmnixCopilotAction('Research my client Alicia', { source: 'public-web' });
    expect(answer.status).toBe('unsupported');
    expect(loadWorkspaceAiRuntimeCredential).not.toHaveBeenCalled();
    expect(routeOmnixQuestionWithGemini).not.toHaveBeenCalled();
    expect(researchWithGemini).not.toHaveBeenCalled();
  });

  it('rejects missing selected contacts without passing browser context to a model', async () => {
    vi.mocked(getRepository).mockResolvedValue({ ...context, repository: { ...context.repository, get: vi.fn(async () => undefined) } });
    const answer = await askOmnixCopilotAction('and her status?', { source: 'crm', contactId: 'other-workspace-contact' });
    expect(answer.status).toBe('empty');
    expect(routeOmnixQuestionWithGemini).not.toHaveBeenCalled();
    expect(executeOmnixCopilot).not.toHaveBeenCalled();
  });

  it.each(['and her status?', 'Show her transactions and next actions'])('keeps the selected canonical identity for %s even with duplicate names', async (question) => {
    const contact = { id: 'selected-1', firstName: 'Alex', lastName: 'Morgan' };
    const get = vi.fn(async () => contact);
    vi.mocked(getRepository).mockResolvedValue({ ...context, isLive: true, repository: { ...context.repository, get } } as unknown as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue({ apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' });
    vi.mocked(routeOmnixQuestionWithGemini).mockResolvedValue({ state: 'available', route: 'crm', query: 'transactions for alex morgan' });
    vi.mocked(executeOmnixCopilot).mockImplementation(async (request) => ({
      ok: true, schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION, command: 'ask',
      resolvedIntent: request.intent, correlationId: request.correlationId, dataMode: 'live', asOf: request.asOf,
      answerBlocks: [], citations: [], suggestions: [], warnings: [], alerts: [],
    }));
    const answer = await askOmnixCopilotAction(question, { source: 'crm', contactId: 'selected-1' });
    expect(get).toHaveBeenCalledWith('selected-1');
    expect(vi.mocked(executeOmnixCopilot).mock.calls[0]?.[0].intent).toMatchObject({ query: 'selected-1' });
    expect(answer.selectedContact).toEqual({ id: 'selected-1', name: 'Alex Morgan' });
  });

  it('adds a grounded Gemini summary and governed proposal without executing it', async () => {
    const contact = { id: 'contact-a', firstName: 'Alicia', lastName: 'Buyer', leadType: 'hot' as const,
      relationship: 'lead' as const, intent: 'buyer' as const, source: 'referral' as const,
      pipelineStage: 'contacted' as const, tags: [], createdAt: '2026-08-01T00:00:00.000Z' };
    const liveContext = {
      ...context, isLive: true,
      repository: { list: vi.fn(async () => [contact]) },
      omnixProposalRepository: createMemoryOmnixProposalRepository(),
    } as unknown as Awaited<ReturnType<typeof getRepository>>;
    vi.mocked(getRepository).mockResolvedValue(liveContext);
    vi.mocked(loadWorkspaceAiRuntimeCredential).mockResolvedValue({
      apiKey: 'stored-server-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private',
    });
    vi.mocked(executeOmnixCopilot).mockImplementation(async (request) => ({
      ok: true, schemaVersion: OMNIX_COPILOT_SCHEMA_VERSION, command: 'ask',
      resolvedIntent: { kind: 'brief', date: 'today' }, correlationId: request.correlationId,
      dataMode: 'live', asOf: request.asOf, answerBlocks: [],
      citations: [{ id: 'citation-1', schemaVersion: 'citation.v1', entityType: 'contact', recordId: contact.id,
        factKeys: ['leadType', 'nextTouchAt'], responseAsOf: request.asOf, target: `/contacts/${contact.id}` }],
      suggestions: [], warnings: [], alerts: [],
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
      label: 'Choose a date and prepare this follow-up', href: '/contacts/contact-a/outcome', commandPreview: 'Call and confirm their current needs.',
    });
    expect(result.suggestions[0]?.detail).toContain('preview only');
  });
});
