#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { generateOmnixNarrative, type OmnixAiBudgetAuthority } from '../lib/application/omnix-generative-narrator.ts';
import { OMNIX_INJECTION_EVAL_CASES, OMNIX_ROUTING_EVAL_CASES, evaluateGroundedNarrative, evaluateInjectionGuard, evaluateRoutingResult, summarizeOmnixAiEvaluation } from '../lib/application/omnix-ai-evaluation.ts';
import { routeOmnixQuestionWithGemini } from '../lib/application/omnix-gemini-router.ts';
import { loadWorkspaceAiRuntimeCredential } from '../lib/application/workspace-ai-settings.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import type { OmnixCopilotSuccessResponse } from '../lib/domain/omnix-copilot.ts';

const citation = { id: 'eval-citation-1', schemaVersion: 'citation.v1' as const, entityType: 'contact' as const, recordId: 'eval-contact-1', factKeys: ['leadType','nextTouchAt'], sourceTimestamp: '2026-08-31T12:00:00.000Z', responseAsOf: '2026-08-31T12:00:00.000Z', target: '/contacts/eval-contact-1' };
const fixture: OmnixCopilotSuccessResponse = { ok: true, schemaVersion: 'omnix-copilot.v1', command: 'ask', resolvedIntent: { kind: 'brief', date: 'today' }, correlationId: 'eval-correlation-1', dataMode: 'live', asOf: '2026-08-31T12:00:00.000Z', answerBlocks: [{ id: 'eval-block-1', kind: 'list', title: 'Priorities', detail: 'One verified follow-up is due.', items: [{ id: 'eval-item-1', label: 'Hot lead follow-up', detail: 'Due today', citations: [citation] }], citations: [citation] }], citations: [citation], suggestions: [], warnings: [], alerts: [] };
const budget: OmnixAiBudgetAuthority = { reserve: async () => ({ allowed: true, reservationId: crypto.randomUUID() }), finalize: async () => undefined };
const usage = 'Usage: npm run omnix:ai:eval -- --live [--output <path>]';

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help')) { process.stdout.write(`${usage}\n`); return 0; }
  if (!argv.includes('--live') || argv.some((value) => !['--live','--output'].includes(value) && argv[argv.indexOf('--output') + 1] !== value)) throw new Error(usage);
  const context = await createAuthenticatedCliContext(); const credential = await loadWorkspaceAiRuntimeCredential(context.scope);
  if (!credential || credential.provider !== 'google-gemini') throw new Error('Judith\'s paid-private Gemini runtime is not configured.');
  const results = [];
  for (const [id, prompt, expected] of OMNIX_ROUTING_EVAL_CASES) results.push(evaluateRoutingResult(id, prompt, expected, await routeOmnixQuestionWithGemini(prompt, { credential })));
  for (const [id, prompt] of OMNIX_INJECTION_EVAL_CASES) results.push(evaluateInjectionGuard(id, prompt));
  for (let index = 1; index <= 3; index += 1) results.push(evaluateGroundedNarrative(`grounding-${index}`, await generateOmnixNarrative('Summarize my verified priority.', fixture, { credential, budget }), new Set([citation.id])));
  const report = summarizeOmnixAiEvaluation(credential.model, results); const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const outputIndex = argv.indexOf('--output'); if (outputIndex >= 0) { const output = argv[outputIndex + 1]; if (!output) throw new Error('--output requires a path.'); await writeFile(output, serialized, { encoding: 'utf8', flag: 'wx' }); }
  process.stdout.write(serialized); return report.passed ? 0 : 6;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'Omnix AI evaluation failed.'}\n`); process.exitCode = 2; });
