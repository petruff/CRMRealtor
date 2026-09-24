'use server';

import {
  mapOmnixCopilotEnvelope,
  type OmnixCopilotRequestOptions,
  type OmnixCopilotUiResult,
} from '@/components/omnix-copilot-view-model';
import { executeOmnixCopilot } from '@/lib/application/omnix-copilot-service';
import { contextualOmnixQuestion, validateOmnixAssistantRequest } from '@/lib/application/omnix-assistant-request';
import { routeOmnixQuestionWithGemini, type OmnixGeminiRouteResult } from '@/lib/application/omnix-gemini-router';
import { routeOmnixQuestionWithClaude } from '@/lib/application/omnix-claude-router';
import { createSupabaseOmnixAiBudgetAuthority } from '@/lib/application/omnix-ai-budget';
import { estimateOmnixCostMicrousd, OMNIX_AI_POLICY, OMNIX_AI_POLICY_VERSION } from '@/lib/application/omnix-ai-policy';
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
import { understandOmnixQuestion } from '@/lib/domain/omnix-understanding';
import {
  confirmOmnixAssistantAction,
  OmnixActionError,
  parseOmnixActionConfirmation,
  prepareOmnixAction,
  type OmnixActionPreview,
} from '@/lib/application/omnix-assistant-actions';
import { revalidatePath } from 'next/cache';
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
    detail: 'Review these highlights alongside the recorded facts below.',
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


function omnixTimeZone(): string {
  return process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York';
}

function localToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: omnixTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Answers that are already complete and plain; an AI summary would only add waiting time. */
const SKIP_NARRATION = new Set(['segment', 'recap', 'find-contact', 'tasks', 'tasks-range', 'dates', 'pipeline', 'help', 'connections', 'mailers', 'campaigns', 'activity']);

function actionMessage(preview: OmnixActionPreview): string {
  if (preview.type === 'need-contact') return 'Who is this for? Include their name, or open their contact and ask again.';
  if (preview.type === 'choose-contact') return 'I found more than one person with that name. Which one?';
  if (preview.type === 'draft-text') return preview.person.phone
    ? `Here are texts for ${preview.person.firstName}. Tap one to open it in Messages — you can edit before sending.`
    : `${preview.person.name} has no phone number saved. Copy a message or add a number first.`;
  if (preview.type === 'create-task') return 'Check the follow-up and tap Save. Nothing is saved until you do.';
  return 'Check the note and tap Save. Nothing is saved until you do.';
}

function actionResultToUi(question: string, correlationId: string, asOf: string, dataMode: OmnixCopilotDataMode, preview: OmnixActionPreview): OmnixCopilotUiResult {
  return {
    status: preview.type === 'need-contact' ? 'unsupported' : 'success',
    question,
    correlationId,
    intent: preview.type,
    dataMode,
    asOf,
    answerBlocks: [],
    citations: [],
    suggestions: [],
    alerts: [],
    warnings: [],
    message: actionMessage(preview),
    action: preview,
    ...('person' in preview ? { selectedContact: { id: preview.person.id, name: preview.person.name } } : {}),
  };
}

export async function askOmnixCopilotAction(
  question: string,
  options?: OmnixCopilotRequestOptions,
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
      errorCategory: 'run-aborted.usage-estimated',
    }).catch(() => undefined);
  };

  try {
    const input = validateOmnixAssistantRequest(question, options);
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
    const selected = input.contactId ? await context.repository.get(input.contactId) : undefined;
    if (input.contactId && !selected) {
      throw new OmnixCopilotError('not-found', 'That contact is no longer available in this workspace. Choose a contact again.');
    }
    const selectedContact = selected ? { id: selected.id, name: `${selected.firstName} ${selected.lastName}`.trim() } : undefined;
    const understood = input.source === 'crm' ? understandOmnixQuestion(question, selectedContact?.id) : undefined;
    if (understood?.kind === 'action') {
      const preview = prepareOmnixAction({
        action: understood.action,
        question,
        contacts: await context.repository.list(),
        ...(selectedContact ? { selectedContactId: selectedContact.id } : {}),
        today: localToday(now),
      });
      await emitOmnixCopilotTelemetry(defaultOmnixCopilotTelemetrySink, {
        correlationId, workspaceId, membershipId, resolvedIntent: `action-${understood.action.type}`, mode: dataMode,
        asOf: now.toISOString(), outcome: 'success', resultCount: 1, citationCount: 0, durationMs: Date.now() - startedAt,
      });
      return actionResultToUi(question, correlationId, now.toISOString(), dataMode, preview);
    }
    let routedQuestion = understood?.kind === 'query' ? understood.query : contextualOmnixQuestion(question, selectedContact?.id);
    try {
      if (input.source === 'public-web') throw new OmnixCopilotError('unsupported-intent', 'Public research requires a separate public question.');
      createOmnixCopilotRequest({ command: 'ask', question: routedQuestion, live: context.isLive, correlationId, now });
    } catch (error) {
      if (!(error instanceof OmnixCopilotError) || error.code !== 'unsupported-intent') throw error;
      credential = await loadOmnixCredential(context.workspaceScope);
      if (!credential || !context.isLive) throw error;
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
        : await routeOmnixQuestionWithGemini(question, {
          credential,
          ...(selectedContact ? { contextContactName: selectedContact.name } : {}),
        });
      if (input.source === 'public-web') {
        if (modelRoute.state !== 'available' || modelRoute.route !== 'public-web'
          || credential?.provider !== 'google-gemini' || !context.isLive || !budget || !reservationId) {
          throw new OmnixCopilotError('unsupported-intent', 'Keep CRM questions in CRM mode. Public web research needs a clearly public topic.');
        }
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
      if (!modelRoute.query || modelRoute.route === 'public-web' || modelRoute.route === 'clarify') {
        throw new OmnixCopilotError('unsupported-intent', modelRoute.route === 'public-web'
          ? 'Choose Public web to research this topic. CRM mode only reads your workspace records.'
          : 'I need a clearer CRM question or a specific client. Try a client status, transactions, properties, or workspace overview.');
      }
      routedQuestion = modelRoute.query;
    }
    let request = createOmnixCopilotRequest({
      command: 'ask', question: routedQuestion, live: context.isLive, correlationId, now,
    });
    if (selectedContact && ['client-status', 'transactions', 'properties', 'nurture', 'finances', 'proposals'].includes(request.intent.kind)
      && /\b(?:her|his|their|this client|this contact|dela|dele)\b/iu.test(question)
      && 'query' in request.intent && request.intent.query?.toLocaleLowerCase('en-US') === selectedContact.name.toLocaleLowerCase('en-US')) {
      request = { ...request, intent: { ...request.intent, query: selectedContact.id } };
    }
    requestDispatched = true;
    const response = await executeOmnixCopilot(request, {
      getRepository: async () => context,
    });
    const mapped = { ...mapOmnixCopilotEnvelope(question, response), ...(selectedContact ? { selectedContact } : {}) };
    if (!response.ok) {
      await finalizeUnusedReservation();
      return mapped;
    }
    if (!credential) {
      credential = await loadOmnixCredential(context.workspaceScope);
    }
    modelProvider = credential?.provider ?? modelProvider;
    if (!credential || credential.provider !== 'google-gemini' || !context.isLive || SKIP_NARRATION.has(request.intent.kind)) {
      if (budget && reservationId && !reservationDelegated) {
        // Routing succeeded and the answer needs no summary: close the receipt with the measured routing usage.
        reservationDelegated = true;
        const inputTokens = modelRoute?.inputTokens ?? 0;
        const outputTokens = Math.min(OMNIX_AI_POLICY.maxOutputTokens, modelRoute?.outputTokens ?? 0);
        await budget.finalize({
          reservationId,
          state: 'succeeded',
          inputTokens,
          outputTokens,
          actualCostMicrousd: Math.min(OMNIX_AI_POLICY.perRunBudgetMicrousd, estimateOmnixCostMicrousd(inputTokens, outputTokens)),
        }).catch(() => undefined);
      }
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
      priorUsageEstimated: modelRoute?.usageEstimated,
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
      const reviewable = narrative.proposals.flatMap((proposal, index) => {
        const receipt = persistence[index];
        if (receipt?.state === 'persisted') return [{ ...proposal, href: receipt.reviewHref }];
        if (receipt?.state === 'review-required') return [{
          ...proposal,
          href: receipt.reviewHref,
          title: 'Choose a date and prepare this follow-up',
          text: `${proposal.text} Open the client review to set the exact task and date. No task has been created.`,
        }];
        return [];
      });
      durableNarrative = { ...narrative, proposals: reviewable };
      if (reviewable.length !== narrative.proposals.length) {
        durableMapped = {
          ...mapped,
          warnings: ['Some suggested actions could not be prepared for review and are not shown.', ...mapped.warnings],
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


export interface OmnixActionConfirmState {
  readonly status: 'idle' | 'saved' | 'error';
  readonly message?: string;
  readonly href?: string;
}

/** Saves a reviewed follow-up or note. Called only from an explicit Save tap. */
export async function confirmOmnixActionAction(payload: unknown): Promise<OmnixActionConfirmState> {
  try {
    const confirmation = parseOmnixActionConfirmation(payload);
    const context = await getRepository();
    if (!context.isLive) return { status: 'saved', message: 'Preview only — sample data is never changed.', href: `/contacts/${encodeURIComponent(confirmation.contactId)}` };
    const result = await confirmOmnixAssistantAction({
      repository: context.repository,
      ...(context.activityRepository ? { activityRepository: context.activityRepository } : {}),
      workspaceScope: context.workspaceScope,
      timeZone: omnixTimeZone(),
    }, confirmation);
    revalidatePath(`/contacts/${confirmation.contactId}`);
    revalidatePath('/');
    return { status: 'saved', message: result.message, href: result.href };
  } catch (error) {
    if (error instanceof OmnixActionError) return { status: 'error', message: error.message };
    console.error('[omnix:action]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'That couldn’t be saved. Nothing was changed.' };
  }
}

/**
 * Records whether an answer helped. Only the answer type and a random answer id
 * are logged — never the question, names or CRM content.
 */
export async function recordOmnixFeedbackAction(input: unknown): Promise<void> {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  const helpful = value.helpful === true ? true : value.helpful === false ? false : undefined;
  const intent = typeof value.intent === 'string' && /^[a-z][a-z-]{1,40}$/u.test(value.intent) ? value.intent : 'unknown';
  const correlationId = typeof value.correlationId === 'string' && /^[A-Za-z0-9-]{8,80}$/u.test(value.correlationId) ? value.correlationId : undefined;
  if (helpful === undefined) return;
  console.info(JSON.stringify({ event: 'omnix.assistant.feedback', helpful, intent, ...(correlationId ? { correlationId } : {}) }));
}

export interface OmnixAssistantProfile {
  readonly available: boolean;
  readonly firstName?: string;
  readonly dataMode: OmnixCopilotDataMode;
  /** The contact open on screen, when the assistant was opened from a contact record. */
  readonly contact?: { readonly id: string; readonly name: string };
}

/**
 * Returns only the minimum identity needed for a friendly greeting. The email
 * address and provider metadata never cross into the assistant surface.
 */
export async function getOmnixAssistantProfileAction(contactId?: unknown): Promise<OmnixAssistantProfile> {
  try {
    const context = await getRepository();
    const normalized = context.userDisplayName?.trim().replace(/\s+/gu, ' ');
    const firstName = normalized?.split(' ')[0]?.slice(0, 120);
    const id = typeof contactId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(contactId) ? contactId : undefined;
    const contact = id ? await context.repository.get(id).catch(() => undefined) : undefined;
    return {
      available: true,
      ...(firstName ? { firstName } : {}),
      dataMode: context.isLive ? 'live' : 'sample',
      ...(contact && !contact.archivedAt ? { contact: { id: contact.id, name: `${contact.preferredName ?? contact.firstName} ${contact.lastName}`.trim() } } : {}),
    };
  } catch {
    return {
      available: false,
      dataMode: isSupabaseConfigured() ? 'live' : 'sample',
    };
  }
}
