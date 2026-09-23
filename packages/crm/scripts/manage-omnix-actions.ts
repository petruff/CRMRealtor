#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  createOmnixProposalCommand,
  decideOmnixProposalCommand,
  listOmnixApprovalInboxCommand,
} from '../lib/application/omnix-proposal-commands.ts';
import { createAuthenticatedCliContext, type AuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseOmnixProposalRepository } from '../lib/data/supabase-omnix-proposal-repository.ts';
import type { OmnixProposalRepository } from '../lib/data/omnix-proposal-repository.ts';

type Command = 'list' | 'show' | 'propose-task' | 'propose-nurture' | 'approve' | 'reject';

export interface OmnixActionsCliDependencies {
  readonly context: () => Promise<AuthenticatedCliContext>;
  readonly repository: (context: AuthenticatedCliContext) => OmnixProposalRepository;
  readonly now?: () => Date;
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
}

function usage(): string {
  return [
    'Usage: npm run omnix:actions -- <command> --live [options]',
    '  list [--state active|all|pending|approved|failed] [--limit 1-500]',
    '  show --id <proposal-id>',
    '  propose-task --contact <id> --title <text> --rationale <text> --due <ISO> --expires <ISO>',
    '    --temperature hot|warm|nurture|unknown --urgency <0-100> [--overdue <days>] [--potential-cents <value>]',
    '  propose-nurture --contact <id> --title <text> --rationale <text> --start <ISO> --expires <ISO>',
    '    --cadence-days <1-365> --maximum-steps <1-120> --temperature hot|warm|nurture|unknown',
    '  approve|reject --id <proposal-id> --version <number> --key <idempotency-key>',
    'All commands require authenticated end-user workspace authority. Approval never sends or executes by itself.',
  ].join('\n');
}

function options(argv: readonly string[]): { command: Command; values: ReadonlyMap<string, string> } {
  const command = argv[0] as Command;
  if (!['list', 'show', 'propose-task', 'propose-nurture', 'approve', 'reject'].includes(command) || !argv.includes('--live')) throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--live') continue;
    if (!key?.startsWith('--') || values.has(key)) throw new Error(usage());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(usage());
    values.set(key, value); index += 1;
  }
  return { command, values };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`${key} is required.\n${usage()}`);
  return value;
}

export async function runOmnixActionsCli(argv: readonly string[], dependencies: OmnixActionsCliDependencies): Promise<number> {
  const write = dependencies.stdout ?? ((value: string) => process.stdout.write(value));
  const writeError = dependencies.stderr ?? ((value: string) => process.stderr.write(value));
  try {
    if (argv.length === 1 && argv[0] === '--help') { write(`${usage()}\n`); return 0; }
    const parsed = options(argv);
    const context = await dependencies.context();
    const repository = dependencies.repository(context);
    const now = dependencies.now?.() ?? new Date();
    let result: unknown;
    if (parsed.command === 'list') {
      result = await listOmnixApprovalInboxCommand(repository, context.scope, {
        state: (parsed.values.get('--state') ?? 'active') as 'active',
        limit: Number(parsed.values.get('--limit') ?? 100),
      });
    } else if (parsed.command === 'show') {
      const proposal = await repository.get(context.scope, required(parsed.values, '--id'));
      if (!proposal) throw new Error('Proposal was not found.');
      const version = await repository.getVersion(context.scope, proposal.id, proposal.currentVersion);
      result = { proposal, version };
    } else if (parsed.command === 'propose-task') {
      const contactId = required(parsed.values, '--contact');
      const dueAt = required(parsed.values, '--due');
      const temperature = required(parsed.values, '--temperature') as 'hot' | 'warm' | 'nurture' | 'unknown';
      result = await createOmnixProposalCommand(repository, context.scope, {
        contactId, kind: 'task-create', origin: 'deterministic', approvalMode: 'active-member',
        factors: {
          urgency: Number(required(parsed.values, '--urgency')), leadTemperature: temperature,
          daysOverdue: Number(parsed.values.get('--overdue') ?? 0), awaitingReply: false,
          potentialValueCents: Number(parsed.values.get('--potential-cents') ?? 0),
        },
        title: required(parsed.values, '--title'), rationale: required(parsed.values, '--rationale'),
        payload: { contactId, title: required(parsed.values, '--title'), dueAt },
        citations: [{ entityType: 'contact', recordId: contactId, factKeys: ['leadType', 'nextTouchAt'], href: `/contacts/${contactId}` }],
        dueAt, expiresAt: required(parsed.values, '--expires'),
        idempotencyKey: `manual-task:${contactId}:${now.toISOString().slice(0, 10)}`,
      }, now);
    } else if (parsed.command === 'propose-nurture') {
      const contactId = required(parsed.values, '--contact');
      const startAt = required(parsed.values, '--start');
      const title = required(parsed.values, '--title');
      const temperature = required(parsed.values, '--temperature') as 'hot' | 'warm' | 'nurture' | 'unknown';
      result = await createOmnixProposalCommand(repository, context.scope, {
        contactId, kind: 'nurture-plan', origin: 'deterministic', approvalMode: 'owner',
        factors: { urgency: 45, leadTemperature: temperature, daysOverdue: 0,
          awaitingReply: false, potentialValueCents: 0 },
        title, rationale: required(parsed.values, '--rationale'),
        payload: {
          contactId, cadenceDays: Number(required(parsed.values, '--cadence-days')),
          maximumSteps: Number(required(parsed.values, '--maximum-steps')), startAt,
        },
        citations: [{ entityType: 'contact', recordId: contactId,
          factKeys: ['leadType', 'pipelineStage', 'nextTouchAt'], href: `/contacts/${contactId}` }],
        dueAt: startAt, expiresAt: required(parsed.values, '--expires'),
        idempotencyKey: `manual-nurture:${contactId}:${now.toISOString().slice(0, 10)}`,
      }, now);
    } else {
      result = await decideOmnixProposalCommand(repository, context.scope, required(parsed.values, '--id'), {
        decision: parsed.command === 'approve' ? 'approve' : 'reject',
        expectedVersion: Number(required(parsed.values, '--version')),
        idempotencyKey: required(parsed.values, '--key'),
      }, now);
    }
    write(`${JSON.stringify({ schemaVersion: 'omnix-actions-cli.v1', command: parsed.command, dataMode: 'live', result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : 'Omnix actions failed.'}\n`);
    return 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runOmnixActionsCli(process.argv.slice(2), {
    context: createAuthenticatedCliContext,
    repository: ({ client }) => supabaseOmnixProposalRepository(client),
  }).then((code) => { process.exitCode = code; });
}
