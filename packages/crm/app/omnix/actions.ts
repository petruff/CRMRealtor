'use server';

import {
  mapOmnixCopilotEnvelope,
  type OmnixCopilotUiResult,
} from '@/components/omnix-copilot-view-model';
import { executeOmnixCopilot } from '@/lib/application/omnix-copilot-service';
import { routeOmnixQuestionWithGemini, type OmnixGeminiRouteResult } from '@/lib/application/omnix-gemini-router';
import { routeOmnixQuestionWithClaude } from '@/lib/application/omnix-claude-router';
import { loadWorkspaceAiCredential, loadWorkspaceGeminiCredential, type WorkspaceAiProvider } from '@/lib/application/workspace-ai-settings';
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

  try {
    const context = await getRepository();
    dataMode = context.isLive ? 'live' : 'sample';
    workspaceId = context.workspaceScope.workspaceId;
    membershipId = context.workspaceScope.membershipId;
    let routedQuestion = question;
    try {
      createOmnixCopilotRequest({ command: 'ask', question, live: context.isLive, correlationId, now });
    } catch (error) {
      if (!(error instanceof OmnixCopilotError) || error.code !== 'unsupported-intent') throw error;
      let credential;
      try {
        credential = await loadWorkspaceAiCredential(context.workspaceScope);
        if (!credential) credential = await loadWorkspaceGeminiCredential(context.workspaceScope);
      } catch {
        credential = await loadWorkspaceGeminiCredential(context.workspaceScope).catch(() => undefined);
      }
      modelProvider = credential && 'provider' in credential ? credential.provider : 'google-gemini';
      modelRoute = credential && 'provider' in credential && credential.provider === 'anthropic-claude'
        ? await routeOmnixQuestionWithClaude(question, { credential })
        : await routeOmnixQuestionWithGemini(question, credential ? { credential } : {});
      if (!modelRoute.query) throw error;
      routedQuestion = modelRoute.query;
    }
    const request = createOmnixCopilotRequest({
      command: 'ask', question: routedQuestion, live: context.isLive, correlationId, now,
    });
    requestDispatched = true;
    const response = await executeOmnixCopilot(request, {
      getRepository: async () => context,
    });
    return {
      ...mapOmnixCopilotEnvelope(question, response),
      ...(modelRoute ? { model: {
        state: modelRoute.state,
        provider: modelProvider,
        ...(modelRoute.model ? { model: modelRoute.model } : {}),
        routed: Boolean(modelRoute.query),
      } } : {}),
    };
  } catch (error) {
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
