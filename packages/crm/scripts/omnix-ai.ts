#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createSupabaseOmnixAiBudgetAuthority } from '../lib/application/omnix-ai-budget.ts';
import { OMNIX_AI_POLICY, OMNIX_AI_POLICY_VERSION } from '../lib/application/omnix-ai-policy.ts';
import { generateOmnixNarrative } from '../lib/application/omnix-generative-narrator.ts';
import { routeOmnixQuestionWithGemini } from '../lib/application/omnix-gemini-router.ts';
import { scanOmnixPromptContent } from '../lib/application/omnix-prompt-guard.ts';
import { researchWithGemini } from '../lib/application/omnix-gemini-research.ts';
import { loadWorkspaceAiRuntimeCredential } from '../lib/application/workspace-ai-settings.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import {
  createOmnixCopilotCorrelationId,
  createOmnixCopilotRequest,
  OmnixCopilotError,
  type OmnixCopilotExecutor,
} from '../lib/domain/omnix-copilot.ts';
import { createDefaultOmnixCopilotCliExecutor } from './omnix-copilot.ts';
import { validateOmnixAssistantRequest } from '../lib/application/omnix-assistant-request.ts';

export interface OmnixAiCliDependencies {
  readonly liveContext: typeof createAuthenticatedCliContext;
  readonly execute: OmnixCopilotExecutor;
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
}

function usage(): string {
  return 'Usage: npm run omnix:ai -- --live --question "What are my priorities today?" [--source crm|public-web]. CRM is the default; public research requires an explicit public question.';
}

function questionFrom(argv: readonly string[]) {
  let live = false, question: string | undefined, source = 'crm'; const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (seen.has(option) || !['--live', '--question', '--source'].includes(option)) throw new Error(usage());
    seen.add(option);
    if (option === '--live') live = true;
    else { const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error(usage());
      if (option === '--question') question = value; else source = value; }
  }
  if (!live) throw new Error('Governed model assistance requires --live authenticated workspace scope.');
  return validateOmnixAssistantRequest(question, { source });
}

export async function runOmnixAiCli(argv: readonly string[], dependencies: OmnixAiCliDependencies): Promise<number> {
  const write = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const writeError = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  let finalizePending: (() => Promise<void>) | undefined;
  try {
    if (argv.length === 1 && argv[0] === '--help') {
      write(`${usage()}\n`);
      return 0;
    }
    const { question, source } = questionFrom(argv);
    if (!scanOmnixPromptContent(question).safe) throw new Error('Question refused by omnix-prompt-guard.v1.');
    const context = await dependencies.liveContext();
    const credential = await loadWorkspaceAiRuntimeCredential(context.scope).catch(() => undefined);
    if (!credential || credential.provider !== 'google-gemini') {
      let deterministic;
      if (source === 'crm') {
        try { deterministic = await dependencies.execute(createOmnixCopilotRequest({ command: 'ask', question, live: true })); }
        catch (error) { if (!(error instanceof OmnixCopilotError) || error.code !== 'unsupported-intent') throw error; }
      }
      write(`${JSON.stringify({ schemaVersion: 'omnix-ai-cli.v1', dataMode: 'live', ...(deterministic ? { deterministic } : { mode: 'clarify', message: 'Use a supported CRM question while model assistance is unavailable.' }), model: { state: 'unconfigured', reason: 'credential-unavailable' } }, null, 2)}\n`);
      return 6;
    }
    const budget = createSupabaseOmnixAiBudgetAuthority(context.client, context.scope);
    const correlationId = createOmnixCopilotCorrelationId();
    let reservationId: string | undefined;
    let routeInputTokens = 0;
    let routeOutputTokens = 0;
    let routeUsageEstimated = false;
    let routedQuestion = question;
    try {
      if (source === 'public-web') throw new OmnixCopilotError('unsupported-intent', 'Public routing requires an explicit classification.');
      createOmnixCopilotRequest({ command: 'ask', question, live: true, correlationId });
    } catch (error) {
      if (!(error instanceof OmnixCopilotError) || error.code !== 'unsupported-intent') throw error;
      const reservation = await budget.reserve({
        correlationId,
        policyVersion: OMNIX_AI_POLICY_VERSION,
        estimatedCostMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd,
        perRunLimitMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd,
        dailyLimitMicrousd: OMNIX_AI_POLICY.dailyWorkspaceBudgetMicrousd,
      });
      if (!reservation.allowed || !reservation.reservationId) {
        throw new Error(reservation.reason === 'exhausted' ? 'The workspace AI budget is exhausted.' : 'The protected AI budget receipt is unavailable.');
      }
      reservationId = reservation.reservationId;
      finalizePending = () => budget.finalize({ reservationId: reservation.reservationId!, state: 'failed', inputTokens: routeInputTokens, outputTokens: routeOutputTokens, actualCostMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd, errorCategory: 'route-or-execution-failed.usage-estimated' });
      const route = await routeOmnixQuestionWithGemini(question, { credential });
      routeInputTokens = route.inputTokens ?? 0;
      routeOutputTokens = route.outputTokens ?? 0;
      routeUsageEstimated = route.usageEstimated === true;
      if (route.state !== 'available' || route.route !== source || !route.query) {
        await finalizePending(); finalizePending = undefined;
        write(`${JSON.stringify({ schemaVersion: 'omnix-ai-cli.v1', correlationId, dataMode: 'live', mode: 'clarify', message: source === 'crm' ? 'Ask a supported CRM question, choose a client, or select Public web for a separate public question.' : 'Ask a separate public question without client information.', model: { state: route.state, reason: route.reason } }, null, 2)}\n`);
        return 6;
      }
      if (source === 'public-web') {
        const research = await researchWithGemini(question, correlationId, {
          credential,
          budget,
          reservation: { reservationId },
          priorInputTokens: routeInputTokens,
          priorOutputTokens: routeOutputTokens,
        });
        finalizePending = undefined;
        write(`${JSON.stringify({
          schemaVersion: 'omnix-ai-cli.v1',
          correlationId,
          dataMode: 'live',
          mode: 'web-research',
          model: research,
        }, null, 2)}\n`);
        return research.state === 'available' ? 0 : 6;
      }
      routedQuestion = route.query;
    }
    const request = createOmnixCopilotRequest({ command: 'ask', question: routedQuestion, live: true, correlationId });
    const deterministic = await dependencies.execute(request);
    if (!deterministic.ok) {
      if (reservationId) {
        await budget.finalize({
          reservationId,
          state: 'failed',
          inputTokens: routeInputTokens,
          outputTokens: routeOutputTokens,
          actualCostMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd,
          errorCategory: 'deterministic-failed.usage-estimated',
        });
        finalizePending = undefined;
      }
      write(`${JSON.stringify({ schemaVersion: 'omnix-ai-cli.v1', deterministic }, null, 2)}\n`);
      return 6;
    }
    const narrative = await generateOmnixNarrative(question, deterministic, {
      credential,
      budget,
      ...(reservationId ? { reservation: { reservationId } } : {}),
      priorInputTokens: routeInputTokens,
      priorOutputTokens: routeOutputTokens,
      priorUsageEstimated: routeUsageEstimated,
    });
    finalizePending = undefined;
    write(`${JSON.stringify({
      schemaVersion: 'omnix-ai-cli.v1',
      correlationId: deterministic.correlationId,
      dataMode: deterministic.dataMode,
      deterministic,
      model: narrative,
    }, null, 2)}\n`);
    return narrative.state === 'available' ? 0 : 6;
  } catch (error) {
    if (finalizePending) { try { await finalizePending(); } catch { writeError('The AI usage receipt is unavailable; no further model work was attempted.\n'); } }
    writeError(`${error instanceof Error ? error.message : 'Omnix AI CLI failed.'}\n${usage()}\n`);
    return 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runOmnixAiCli(process.argv.slice(2), {
    liveContext: createAuthenticatedCliContext,
    execute: createDefaultOmnixCopilotCliExecutor(),
  }).then((code) => { process.exitCode = code; });
}
