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

export interface OmnixAiCliDependencies {
  readonly liveContext: typeof createAuthenticatedCliContext;
  readonly execute: OmnixCopilotExecutor;
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
}

function usage(): string {
  return 'Usage: npm run omnix:ai -- --live --question "What are my priorities today?"';
}

function questionFrom(argv: readonly string[]): string {
  if (!argv.includes('--live')) throw new Error('Governed model assistance requires --live authenticated workspace scope.');
  const index = argv.indexOf('--question');
  const question = index >= 0 ? argv[index + 1]?.trim() : undefined;
  if (!question || argv.length !== 3 || argv.filter((value) => value === '--live').length !== 1
    || argv.filter((value) => value === '--question').length !== 1) {
    throw new Error(usage());
  }
  return question;
}

export async function runOmnixAiCli(argv: readonly string[], dependencies: OmnixAiCliDependencies): Promise<number> {
  const write = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const writeError = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  try {
    if (argv.length === 1 && argv[0] === '--help') {
      write(`${usage()}\n`);
      return 0;
    }
    const question = questionFrom(argv);
    if (!scanOmnixPromptContent(question).safe) throw new Error('Question refused by omnix-prompt-guard.v1.');
    const context = await dependencies.liveContext();
    const credential = await loadWorkspaceAiRuntimeCredential(context.scope);
    if (!credential || credential.provider !== 'google-gemini') throw new Error('A paid-private Gemini runtime is unavailable for this workspace.');
    const budget = createSupabaseOmnixAiBudgetAuthority(context.client, context.scope);
    const correlationId = createOmnixCopilotCorrelationId();
    let reservationId: string | undefined;
    let routeInputTokens = 0;
    let routeOutputTokens = 0;
    let routedQuestion = question;
    try {
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
      const route = await routeOmnixQuestionWithGemini(question, { credential });
      routeInputTokens = route.inputTokens ?? 0;
      routeOutputTokens = route.outputTokens ?? 0;
      if (!route.query) {
        const research = await researchWithGemini(question, correlationId, {
          credential,
          budget,
          reservation: { reservationId },
          priorInputTokens: routeInputTokens,
          priorOutputTokens: routeOutputTokens,
        });
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
          errorCategory: 'deterministic-failed',
        });
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
    });
    write(`${JSON.stringify({
      schemaVersion: 'omnix-ai-cli.v1',
      correlationId: deterministic.correlationId,
      dataMode: deterministic.dataMode,
      deterministic,
      model: narrative,
    }, null, 2)}\n`);
    return narrative.state === 'available' ? 0 : 6;
  } catch (error) {
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
