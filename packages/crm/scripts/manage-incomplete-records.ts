#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  archiveIncompleteRecordCommand,
  convertIncompleteRecordCommand,
  listIncompleteRecordsCommand,
  restoreIncompleteRecordCommand,
  showIncompleteRecordCommand,
} from '../lib/application/incomplete-record-commands.ts';
import { createMemoryIncompleteRecordRepository } from '../lib/data/memory-incomplete-record-repository.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseIncompleteRecordRepository } from '../lib/data/supabase-incomplete-record-repository.ts';
import type { IncompleteRecordRepository } from '../lib/data/incomplete-record-repository.ts';
import type { IncompleteRecord, IncompleteRecordStatus } from '../lib/domain/incomplete-record.ts';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  parseJsonOption,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

export type IncompleteRecordCliCommand = 'list' | 'show' | 'convert' | 'archive' | 'restore';

interface Options {
  command: IncompleteRecordCliCommand;
  live: boolean;
  detail: boolean;
  id?: string;
  status?: IncompleteRecordStatus | 'all';
  query?: string;
  limit?: string;
  correctionJson?: string;
  idempotencyKey?: string;
  reason?: string;
}

export interface IncompleteRecordCliContext {
  repository: IncompleteRecordRepository;
  scope: WorkspaceScope;
}

export interface IncompleteRecordCliDependencies extends CliOutput {
  readonly sampleContext?: () => IncompleteRecordCliContext;
  readonly liveContext?: () => Promise<IncompleteRecordCliContext>;
  readonly now?: () => Date;
}

const COMMANDS: readonly IncompleteRecordCliCommand[] = ['list', 'show', 'convert', 'archive', 'restore'];

function usage(): string {
  return [
    'Usage: npm run incomplete-records -- <command> [options] [--live]',
    'Commands:',
    '  list [--status pending|converted|archived|all] [--query <text>] [--limit <1-500>]',
    '  show --id <record-id> [--detail]',
    '  convert --id <record-id> --idempotency-key <key> [--correction-json <json>]',
    '  archive --id <record-id> --reason <text>',
    '  restore --id <record-id>',
    'List/show redact candidate PII unless --detail is explicitly supplied to show.',
    'Default mode is explicit, non-durable sample data. JSON output is stable v1.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as IncompleteRecordCliCommand)) cliUsageError(usage());
  const selected: Options = {
    command: argv[0] as IncompleteRecordCliCommand,
    live: false,
    detail: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--detail') selected.detail = true;
    else if (argument === '--id') selected.id = optionValue(argv, index++, '--id');
    else if (argument === '--query') selected.query = optionValue(argv, index++, '--query');
    else if (argument === '--limit') selected.limit = optionValue(argv, index++, '--limit');
    else if (argument === '--correction-json') selected.correctionJson = optionValue(argv, index++, '--correction-json');
    else if (argument === '--idempotency-key') selected.idempotencyKey = optionValue(argv, index++, '--idempotency-key');
    else if (argument === '--reason') selected.reason = optionValue(argv, index++, '--reason');
    else if (argument === '--status') {
      const status = optionValue(argv, index++, '--status');
      if (status !== 'pending' && status !== 'converted' && status !== 'archived' && status !== 'all') {
        cliUsageError('Status is invalid.');
      }
      selected.status = status;
    } else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  if (selected.detail && selected.command !== 'show') cliUsageError('--detail is only valid for show.');
  return selected;
}

const sampleRecord: IncompleteRecord = {
  id: 'incomplete-sample-1',
  workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
  source: 'website',
  externalId: 'sample-provider-1',
  candidate: { firstName: 'Sample', email: 'needs-correction@', phone: '3055550100' },
  reasons: [{ field: 'email', code: 'invalid-email', message: 'email is invalid.' }],
  status: 'pending',
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

export function createSampleIncompleteRecordCliContext(): IncompleteRecordCliContext {
  return {
    repository: createMemoryIncompleteRecordRepository({ initialRecords: [sampleRecord] }),
    scope: SAMPLE_WORKSPACE_SCOPE,
  };
}

export async function createLiveIncompleteRecordCliContext(): Promise<IncompleteRecordCliContext> {
  const { client, scope } = await createAuthenticatedCliContext();
  return { repository: supabaseIncompleteRecordRepository(client), scope };
}

function redacted(record: IncompleteRecord) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    source: record.source,
    status: record.status,
    identitySignals: {
      name: Boolean(record.candidate.firstName || record.candidate.lastName),
      phone: Boolean(record.candidate.phone),
      email: Boolean(record.candidate.email),
      externalId: Boolean(record.externalId),
    },
    validationReasonCodes: record.reasons.map((reason) => reason.code),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.convertedContactId ? { convertedContactId: record.convertedContactId } : {}),
  };
}

async function execute(selected: Options, context: IncompleteRecordCliContext, now: Date): Promise<unknown> {
  if (selected.command === 'list') {
    const records = await listIncompleteRecordsCommand(context.repository, context.scope, {
      status: selected.status,
      query: selected.query,
      limit: selected.limit,
    });
    return records.map(redacted);
  }
  if (selected.command === 'show') {
    const record = await showIncompleteRecordCommand(context.repository, context.scope, selected.id);
    return selected.detail ? { detailRequested: true, record } : redacted(record);
  }
  if (selected.command === 'convert') {
    const receipt = await convertIncompleteRecordCommand(context.repository, context.scope, selected.id, {
      correction: selected.correctionJson ? parseJsonOption(selected.correctionJson, '--correction-json') : {},
      idempotencyKey: selected.idempotencyKey,
    }, now);
    return {
      recordId: receipt.record.id,
      contactId: receipt.contactId,
      action: receipt.action,
      noOp: receipt.noOp,
      status: receipt.record.status,
    };
  }
  if (selected.command === 'archive') {
    const result = await archiveIncompleteRecordCommand(
      context.repository, context.scope, selected.id, selected.reason, now,
    );
    return { record: redacted(result.record), noOp: result.noOp };
  }
  const result = await restoreIncompleteRecordCommand(context.repository, context.scope, selected.id, now);
  return { record: redacted(result.record), noOp: result.noOp };
}

export async function runIncompleteRecordCli(
  argv: readonly string[],
  dependencies: IncompleteRecordCliDependencies = {},
): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    const context = live
      ? await (dependencies.liveContext ?? createLiveIncompleteRecordCliContext)()
      : (dependencies.sampleContext ?? createSampleIncompleteRecordCliContext)();
    const result = await execute(selected, context, (dependencies.now ?? (() => new Date()))());
    return writeCliEnvelope(dependencies, {
      ok: true, resource: 'incomplete-records', command: selected.command, live, result,
    });
  } catch (error) {
    return writeCliEnvelope(dependencies, { ok: false, resource: 'incomplete-records', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runIncompleteRecordCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
