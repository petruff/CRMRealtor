#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createCaptureOutcomeService, type AnalyzeCaptureInput } from '../lib/application/capture-outcome-service.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseCaptureOutcomeRepository } from '../lib/data/supabase-capture-outcome-repository.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseActivityRepository } from '../lib/data/supabase-activity-repository.ts';
import { supabaseOmnixProposalRepository } from '../lib/data/supabase-omnix-proposal-repository.ts';
import { supabasePipelineRepository } from '../lib/data/supabase-pipeline-repository.ts';
import { supabaseNurturePlanRepository } from '../lib/data/supabase-nurture-plan-repository.ts';
import { extractAndRecordCaptureOutcome } from '../lib/application/capture-outcome-observed-extraction.ts';
import { recordCaptureRunTelemetry } from '../lib/data/capture-run-telemetry.ts';
import { createSupabaseOmnixAiBudgetAuthority } from '../lib/application/omnix-ai-budget.ts';
import { loadWorkspaceAiRuntimeCredential } from '../lib/application/workspace-ai-settings.ts';
import type { WorkspaceScope } from '../lib/domain/workspace.ts';
import type { CaptureOperationAfter, CaptureOperationType } from '../lib/domain/capture-outcome.ts';
import { supabaseRichContactRepository } from '../lib/data/supabase-rich-contact-repository.ts';
import { supabaseConnectorRepository } from '../lib/data/supabase-connector-repository.ts';
import { supabaseContactOutboundGuard } from '../lib/data/supabase-contact-outbound-guard.ts';
import { loadConfiguredConnectorRuntimeConfiguration } from '../lib/config/connector-runtime.ts';
import { createOmnixProviderServerGateway } from '../lib/application/omnix-provider-gateway.ts';

const usage = 'Usage: npm run omnix:capture -- --live <analyze|get|list|options|add|edit|select|confirm|defer|reject>\nRead a bounded JSON command payload from stdin. analyze: {contactId,sourceText,idempotencyKey,manualOnly?,tasks?}; get: {id}; options: {contactId}; add: {id,version,type,after}; edit: {id,version,operationId,patch}; select: {id,version,ids}; confirm: {id,version,contentHash}; defer: {id,version,until}; reject: {id,version}. No send operation is supported.';
export async function runCaptureOutcomeCli(argv: readonly string[], dependencies: {
  context: () => Promise<{ scope: WorkspaceScope; service: ReturnType<typeof createCaptureOutcomeService> }>;
  readInput: () => Promise<string>;
  stdout: (text: string) => void;
}): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') { dependencies.stdout(usage); return 0; }
  try {
    const command = argv[1];
    if (argv.length !== 2 || argv[0] !== '--live' || !['analyze', 'get', 'list', 'options', 'add', 'edit', 'select', 'confirm', 'defer', 'reject'].includes(command ?? '')) throw new Error('invalid-input');
    const raw = await dependencies.readInput();
    if (Buffer.byteLength(raw, 'utf8') > 40000) throw new Error('invalid-input');
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || Array.isArray(input) || typeof input !== 'object' || ['workspaceId', 'ownerUserId', 'membershipId'].some((key) => key in input)) throw new Error('invalid-input');
    const { scope, service } = await dependencies.context();
    const id = typeof input.id === 'string' ? input.id : '';
    const version = Number(input.version);
    let data: unknown;
    if (command === 'analyze') data = await service.analyze(scope, input as unknown as AnalyzeCaptureInput);
    else if (command === 'list') data = await service.list(scope, typeof input.contactId === 'string' ? input.contactId : undefined);
    else if (command === 'get') data = await service.get(scope, id);
    else if (command === 'options') data = await service.options(scope, String(input.contactId ?? ''));
    else if (command === 'add') data = await service.addOperation(scope, id, version, { type: input.type as CaptureOperationType, after: input.after as CaptureOperationAfter });
    else if (command === 'select') data = await service.select(scope, id, version, input.ids as string[]);
    else if (command === 'confirm') data = await service.confirm(scope, id, version, String(input.contentHash ?? ''));
    else if (command === 'edit') data = await service.edit(scope, id, version, String(input.operationId ?? ''), input.patch as CaptureOperationAfter);
    else if (command === 'defer') data = await service.defer(scope, id, version, String(input.until ?? ''));
    else data = await service.reject(scope, id, version);
    dependencies.stdout(JSON.stringify({ ok: true, schemaVersion: 'capture-outcome.v1', command, data })); return 0;
  } catch (error) {
    const code = (error as { code?: string }).code;
    dependencies.stdout(JSON.stringify({ ok: false, schemaVersion: 'capture-outcome.v1', code: code && /^[a-z-]{1,30}$/.test(code) ? code : 'invalid-input', message: 'Capture command failed. Check input or reload the current review.' })); return 1;
  }
}
async function stdin(): Promise<string> {
  let value = '';
  for await (const chunk of process.stdin) { value += String(chunk); if (Buffer.byteLength(value, 'utf8') > 40000) throw new Error('oversized'); }
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCaptureOutcomeCli(process.argv.slice(2), {
    readInput: stdin, stdout: (text) => process.stdout.write(`${text}\n`),
    context: async () => {
      const { scope, client } = await createAuthenticatedCliContext();
      const contacts = supabaseRepository(client, scope);
      const activities = supabaseActivityRepository(client);
      const richContacts = supabaseRichContactRepository(client);
      const connectors = supabaseConnectorRepository(client, loadConfiguredConnectorRuntimeConfiguration().definitions);
      const providerGateway = createOmnixProviderServerGateway({ isLive: true, workspaceScope: scope, repository: contacts, richContactRepository: richContacts, connectorRepository: connectors, activityRepository: activities }, client);
      return { scope, service: createCaptureOutcomeService({ contacts, captures: supabaseCaptureOutcomeRepository(client), proposals: supabaseOmnixProposalRepository(client), activities, pipeline: supabasePipelineRepository(client), nurture: supabaseNurturePlanRepository(client), richContacts, connectors, outboundGuard: supabaseContactOutboundGuard(client), providerGateway,
        extract: async (source, contactId) => {
          const credential = await loadWorkspaceAiRuntimeCredential(scope);
          return extractAndRecordCaptureOutcome(source, { ...(credential?.provider === 'google-gemini' ? { credential } : {}), budget: createSupabaseOmnixAiBudgetAuthority(client, scope) }, (telemetry) => recordCaptureRunTelemetry(client, scope, contactId, telemetry));
        },
      }) };
    },
  });
}
