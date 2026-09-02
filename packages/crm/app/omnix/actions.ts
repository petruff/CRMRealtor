'use server';

import {
  mapOmnixCopilotEnvelope,
  type OmnixCopilotUiResult,
} from '@/components/omnix-copilot-view-model';
import { executeOmnixCopilot } from '@/lib/application/omnix-copilot-service';
import { routeOmnixQuestionWithGemini, type OmnixGeminiRouteResult } from '@/lib/application/omnix-gemini-router';
import { routeOmnixQuestionWithClaude } from '@/lib/application/omnix-claude-router';
import { createSupabaseOmnixAiBudgetAuthority } from '@/lib/application/omnix-ai-budget';
import { OMNIX_AI_POLICY, OMNIX_AI_POLICY_VERSION } from '@/lib/application/omnix-ai-policy';
import {
  generateOmnixNarrative,
  type OmnixAiBudgetAuthority,
  type OmnixGenerativeResult,
} from '@/lib/application/omnix-generative-narrator';
import { scanOmnixPromptContent } from '@/lib/application/omnix-prompt-guard';
import { researchWithGemini, type OmnixResearchResult } from '@/lib/application/omnix-gemini-research';
import { persistGeneratedOmnixProposals } from '@/lib/application/omnix-generated-proposal-persistence';
import { loadWorkspaceAiRuntimeCredential, type WorkspaceAiCredential, type WorkspaceAiProvider } from '@/lib/application/workspace-ai-settings';
import { getRepository } from '@/lib/data';
import {
  createOmnixCopilotCorrelationId,
  createOmnixCopilotErrorResponse,
  createOmnixCopilotRequest,
  type OmnixCopilotDataMode,
  OmnixCopilotError,
} from '@/lib/domain/omnix-copilot';
import {
  defaultOmnixCopilotTelemetrySink,
  emitOmnixCopilotTelemetry,
  omnixCopilotTelemetryErrorCategory,
} from '@/lib/observability/omnix-copilot-telemetry';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function loadOmnixCredential(scope: Parameters<typeof loadWorkspaceAiRuntimeCredential>[0]): Promise<WorkspaceAiCredential | undefined> {
  return loadWorkspaceAiRuntimeCredential(scope).catch(() => undefined);
}

function generativeWarning(result: OmnixGenerativeResult): string | undefined {
  if (result.state === 'available' || result.state === 'unconfigured') return undefined;
  if (result.reason === 'guard-refused') return 'AI summary was skipped because untrusted content triggered the safety guard. The CRM facts below are unchanged.';
  if (result.reason === 'budget-exhausted') return 'AI summary is paused for today because the workspace budget limit was reached. The CRM facts below remain available.';
  if (result.reason === 'budget-unavailable') return 'AI summary is temporarily unavailable because its protected usage receipt could not be reserved. The CRM facts below remain available.';
  return 'AI summary is temporarily unavailable. The verified CRM facts below remain available.';
}

function addGenerativeResult(
  mapped: OmnixCopilotUiResult,
  narrative: OmnixGenerativeResult,
  provider: WorkspaceAiProvider,
  routed: boolean,
): OmnixCopilotUiResult {
  const warning = generativeWarning(narrative);
  if (narrative.state !== 'available' || !narrative.summary) {
    return {
      ...mapped,
      ...(warning ? { warnings: [warning, ...mapped.warnings] } : {}),
      model: {
        state: narrative.state,
        provider,
        ...(narrative.model ? { model: narrative.model } : {}),
        routed,
        narrated: false,
        policyVersion: narrative.policyVersion,
      },
    };
  }
  const generatedBlocks: OmnixCopilotUiResult['answerBlocks'] = [{
    id: 'ai-grounded-summary',
    kind: 'summary',
    title: 'Omnix summary',
    detail: narrative.summary.text,
    items: [],
    citationIds: [...narrative.summary.citationIds],
  }];
  if (narrative.highlights.length) generatedBlocks.push({
    id: 'ai-grounded-highlights',
    kind: 'list',
    title: 'What matters most',
    detail: 'Prioritized from the verified CRM records below.',
    items: narrative.highlights.map((item, index) => ({
      id: `ai-highlight-${index + 1}`,
      label: item.text,
      citationIds: [...item.citationIds],
    })),
    citationIds: [],
  });
  if (narrative.unknowns.length) generatedBlocks.push({
    id: 'ai-explicit-unknowns',
    kind: 'empty',
    title: 'Information not established',
    detail: narrative.unknowns.join(' · '),
    items: [],
    citationIds: [],
  });
  return {
    ...mapped,
    answerBlocks: [...generatedBlocks, ...mapped.answerBlocks],
    suggestions: [
      ...narrative.proposals.map((proposal, index) => ({
        id: `ai-proposal-${proposal.kind}-${index + 1}`,
        label: proposal.title,
        detail: `${proposal.text} This is a preview only; review and approval are still required.`,
        href: proposal.href,
        commandPreview: proposal.preview,
        citationIds: [...proposal.citationIds],
      })),
      ...mapped.suggestions,
    ],
    model: {
      state: 'available', provider, model: narrative.model, routed, narrated: true,
      policyVersion: narrative.policyVersion,
    },
  };
}

function researchResultToUi(
  question: string,
  correlationId: string,
  asOf: string,
  research: OmnixResearchResult,
): OmnixCopilotUiResult {
  if (research.state !== 'available' || !research.answer) {
    const message = research.reason === 'budget-exhausted'
      ? 'Web research is paused because the workspace AI budget was reached. Nothing was changed.'
      : research.reason === 'sources-unavailable'
        ? "I found an answer, but couldn't verify it with safe public sources, so I withheld it. Nothing was changed."
        : research.reason === 'guard-refused'
          ? "I can't research that wording safely. Rephrase the question without instructions to reveal prompts, secrets, files, or code."
          : 'Web research is temporarily unavailable. Nothing was changed.';
    return {
      status: 'unavailable',
      question,
      correlationId,
      intent: 'web-research',
      asOf,
      answerBlocks: [],
      citations: [],
      suggestions: [],
      alerts: [],
      warnings: [message],
      message,
      model: {
        state: research.state,
        provider: 'google-gemini',
        ...(research.model ? { model: research.model } : {}),
        routed: false,
        narrated: false,
        researched: true,
        policyVersion: research.policyVersion,
      },
    };
  }
  const citationIds = research.sources.map((source) => source.id);
  return {
    status: 'success',
    question,
    correlationId,
    intent: 'web-research',
    asOf,
    answerBlocks: [{
      id: 'web-research-answer',
      kind: 'summary',
      title: 'Research answer',
      detail: research.answer,
      items: [],
      citationIds,
    }],
    citations: research.sources.map((source) => ({
      id: source.id,
      entityType: 'web',
      recordId: source.id,
      factKeys: ['public web source'],
      asOf,
      target: source.url,
      displayLabel: source.title,
    })),
    suggestions: [],
    alerts: [],
    warnings: [...research.warnings],
    model: {
      state: 'available',
      provider: 'google-gemini',
      model: research.model,
      routed: false,
      narrated: false,
      researched: true,
      policyVersion: research.policyVersion,
    },
  };
}

export async function askOmnixCopilotAction(
  question: string,
): Promise<OmnixCopilotUiResult> {
  const now = new Date();
  const startedAt = Date.now();
  const correlationId = createOmnixCopilotCorrelationId();
  let dataMode: OmnixCopilotDataMode = isSupabaseConfigured() ? 'live' : 'sample';
  let workspaceId = 'unresolved';
  let membershipId = 'unresolved';
  let requestDispatched = false;
  let modelRoute: OmnixGeminiRouteResult | undefined;
  let modelProvider: WorkspaceAiProvider = 'google-gemini';
  let credential: WorkspaceAiCredential | undefined;
  let budget: OmnixAiBudgetAuthority | undefined;
  let reservationId: string | undefined;
  let reservationDelegated = false;

  const finalizeUnusedReservation = async () => {
    if (!budget || !reservationId || reservationDelegated) return;
    reservationDelegated = true;
    await budget.finalize({
      reservationId,
      state: 'failed',
      inputTokens: modelRoute?.inputTokens ?? 0,
      outputTokens: modelRoute?.outputTokens ?? 0,
      actualCostMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd,
      errorCategory: 'run-aborted',
    }).catch(() => undefined);
  };

  try {
    const context = await getRepository();
    dataMode = context.isLive ? 'live' : 'sample';
    workspaceId = context.workspaceScope.workspaceId;
    membershipId = context.workspaceScope.membershipId;
    const guard = scanOmnixPromptContent(question);
    if (!guard.safe) {
      throw new OmnixCopilotError(
        'invalid-input',
        "I can't process that wording safely. Rephrase the CRM question without instructions to reveal, override, browse files, or run code.",
      );
    }
    let routedQuestion = question;
    try {
      createOmnixCopilotRequest({ command: 'ask', question, live: context.isLive, correlationId, now });
    } catch (error) {
      if (!(error instanceof OmnixCopilotError) || error.code !== 'unsupported-intent') throw error;
      credential = await loadOmnixCredential(context.workspaceScope);
      modelProvider = credential?.provider ?? 'google-gemini';
      if (credential?.provider === 'google-gemini' && context.isLive) {
        const supabase = await createSupabaseServerClient();
        budget = createSupabaseOmnixAiBudgetAuthority(supabase, context.workspaceScope);
        const reservation = await budget.reserve({
          correlationId,
          policyVersion: OMNIX_AI_POLICY_VERSION,
          estimatedCostMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd,
          perRunLimitMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd,
          dailyLimitMicrousd: OMNIX_AI_POLICY.dailyWorkspaceBudgetMicrousd,
        }).catch(() => ({ allowed: false as const, reason: 'unavailable' as const }));
        if (!reservation.allowed || !reservation.reservationId) {
          modelRoute = {
            state: 'failed',
            reason: reservation.reason === 'exhausted' ? 'budget-exhausted' : 'budget-unavailable',
          };
          throw error;
        }
        reservationId = reservation.reservationId;
      }
      modelRoute = credential?.provider === 'anthropic-claude'
        ? await routeOmnixQuestionWithClaude(question, { credential })
        : await routeOmnixQuestionWithGemini(question, credential ? { credential } : {});
      if (!modelRoute.query) {
        if (credential?.provider !== 'google-gemini' || !context.isLive || !budget || !reservationId) throw error;
        reservationDelegated = true;
        const research = await researchWithGemini(question, correlationId, {
          credential,
          budget,
          reservation: { reservationId },
          priorInputTokens: modelRoute.inputTokens,
          priorOutputTokens: modelRoute.outputTokens,
        });
        const researched = researchResultToUi(question, correlationId, now.toISOString(), research);
        await emitOmnixCopilotTelemetry(defaultOmnixCopilotTelemetrySink, {
          correlationId,
          workspaceId,
          membershipId,
          resolvedIntent: 'web-research',
          mode: dataMode,
          asOf: now.toISOString(),
          outcome: research.state === 'available' ? 'success' : 'failure',
          resultCount: research.state === 'available' ? 1 : 0,
          citationCount: research.sources.length,
          durationMs: Date.now() - startedAt,
          ...(research.state === 'available' ? {} : { errorCategory: 'capability-unavailable' }),
        });
        return researched;
      }
      routedQuestion = modelRoute.query;
    }
    const request = createOmnixCopilotRequest({
      command: 'ask', question: routedQuestion, live: context.isLive, correlationId, now,
    });
    requestDispatched = true;
    const response = await executeOmnixCopilot(request, {
      getRepository: async () => context,
    });
    const mapped = mapOmnixCopilotEnvelope(question, response);
    if (!response.ok) {
      await finalizeUnusedReservation();
      return mapped;
    }
    if (!credential) {
      credential = await loadOmnixCredential(context.workspaceScope);
    }
    modelProvider = credential?.provider ?? modelProvider;
    if (!credential || credential.provider !== 'google-gemini' || !context.isLive) {
      return modelRoute ? {
        ...mapped,
        model: {
          state: modelRoute.state, provider: modelProvider,
          ...(modelRoute.model ? { model: modelRoute.model } : {}),
          routed: Boolean(modelRoute.query), narrated: false,
        },
      } : mapped;
    }
    if (!budget) {
      const supabase = await createSupabaseServerClient();
      budget = createSupabaseOmnixAiBudgetAuthority(supabase, context.workspaceScope);
    }
    reservationDelegated = Boolean(reservationId);
    const narrative = await generateOmnixNarrative(question, response, {
      credential,
      budget,
      ...(reservationId ? { reservation: { reservationId } } : {}),
      priorInputTokens: modelRoute?.inputTokens,
      priorOutputTokens: modelRoute?.outputTokens,
    });
    let durableNarrative = narrative;
    let durableMapped = mapped;
    if (narrative.state === 'available' && narrative.proposals.length > 0) {
      const persistence = await persistGeneratedOmnixProposals({
        repository: context.omnixProposalRepository,
        scope: context.workspaceScope,
        contacts: await context.repository.list(),
        response,
        narrative,
        now,
      }).catch(() => []);
      if (persistence.length !== narrative.proposals.length
        || persistence.some((item) => item.state !== 'persisted')) {
        durableNarrative = { ...narrative, proposals: [] };
        durableMapped = {
          ...mapped,
          warnings: ['Omnix could not save the suggested actions for review, so no action preview is shown.', ...mapped.warnings],
        };
      }
    }
    return addGenerativeResult(durableMapped, durableNarrative, modelProvider, Boolean(modelRoute?.query));
  } catch (error) {
    await finalizeUnusedReservation();
    if (!requestDispatched) {
      await emitOmnixCopilotTelemetry(defaultOmnixCopilotTelemetrySink, {
        correlationId,
        workspaceId,
        membershipId,
        resolvedIntent: 'unresolved',
        mode: dataMode,
        asOf: now.toISOString(),
        outcome: 'failure',
        errorCategory: omnixCopilotTelemetryErrorCategory(error),
        resultCount: 0,
        citationCount: 0,
        durationMs: Date.now() - startedAt,
      });
    }
    return {
      ...mapOmnixCopilotEnvelope(question, createOmnixCopilotErrorResponse({
      command: 'ask',
      correlationId,
      dataMode,
      asOf: now.toISOString(),
      error,
      })),
      ...(modelRoute ? { model: {
        state: modelRoute.state,
        provider: modelProvider,
        ...(modelRoute.model ? { model: modelRoute.model } : {}),
        routed: false,
      } } : {}),
    };
  }
}

export interface OmnixAssistantProfile {
  readonly available: boolean;
  readonly firstName?: string;
  readonly dataMode: OmnixCopilotDataMode;
}

/**
 * Returns only the minimum identity needed for a friendly greeting. The email
 * address and provider metadata never cross into the assistant surface.
 */
export async function getOmnixAssistantProfileAction(): Promise<OmnixAssistantProfile> {
  try {
    const context = await getRepository();
    const normalized = context.userDisplayName?.trim().replace(/\s+/gu, ' ');
    const firstName = normalized?.split(' ')[0]?.slice(0, 120);
    return {
      available: true,
      ...(firstName ? { firstName } : {}),
      dataMode: context.isLive ? 'live' : 'sample',
    };
  } catch {
    return {
      available: false,
      dataMode: isSupabaseConfigured() ? 'live' : 'sample',
    };
  }
}
