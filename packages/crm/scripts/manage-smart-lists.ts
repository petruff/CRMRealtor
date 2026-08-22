#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  applySmartListCommand,
  archiveSmartListCommand,
  createSmartListCommand,
  listSmartListsCommand,
  restoreSmartListCommand,
  showSmartListCommand,
  updateSmartListCommand,
} from '../lib/application/smart-list-commands.ts';
import { createMemorySmartListRepository } from '../lib/data/memory-smart-list-repository.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseSmartListRepository } from '../lib/data/supabase-smart-list-repository.ts';
import type { SmartListContactSource, SmartListRepository } from '../lib/data/smart-list-repository.ts';
import type { Contact } from '../lib/domain/contact.ts';
import { SMART_LIST_SCHEMA_VERSION, type SmartList } from '../lib/domain/smart-list.ts';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  parseJsonOption,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

export type SmartListCliCommand = 'create' | 'list' | 'show' | 'apply' | 'update' | 'archive' | 'restore';

interface Options {
  command: SmartListCliCommand;
  live: boolean;
  id?: string;
  name?: string;
  definitionJson?: string;
  status?: 'active' | 'archived' | 'all';
  reason?: string;
}

export interface SmartListCliContext {
  repository: SmartListRepository;
  contacts: SmartListContactSource;
  scope: WorkspaceScope;
}

export interface SmartListCliDependencies extends CliOutput {
  readonly sampleContext?: () => SmartListCliContext;
  readonly liveContext?: () => Promise<SmartListCliContext>;
  readonly now?: () => Date;
}

const COMMANDS: readonly SmartListCliCommand[] = ['create', 'list', 'show', 'apply', 'update', 'archive', 'restore'];

function usage(): string {
  return [
    'Usage: npm run smart-lists -- <command> [options] [--live]',
    'Commands:',
    '  create --name <name> --definition-json <json>',
    '  list [--status active|archived|all]',
    '  show --id <smart-list-id>',
    '  apply --id <smart-list-id>',
    '  update --id <id> [--name <name>] [--definition-json <json>]',
    '  archive --id <id> [--reason <text>]',
    '  restore --id <id>',
    'Default mode is explicit, non-durable sample data. JSON output is stable v1.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as SmartListCliCommand)) cliUsageError(usage());
  const selected: Options = { command: argv[0] as SmartListCliCommand, live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--id') selected.id = optionValue(argv, index++, '--id');
    else if (argument === '--name') selected.name = optionValue(argv, index++, '--name');
    else if (argument === '--definition-json') selected.definitionJson = optionValue(argv, index++, '--definition-json');
    else if (argument === '--reason') selected.reason = optionValue(argv, index++, '--reason');
    else if (argument === '--status') {
      const status = optionValue(argv, index++, '--status');
      if (status !== 'active' && status !== 'archived' && status !== 'all') cliUsageError('Status is invalid.');
      selected.status = status;
    } else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return selected;
}

function sampleContact(id: string, leadType: Contact['leadType']): Contact {
  return {
    id, firstName: id, lastName: 'Sample', leadType, relationship: 'lead', intent: 'buyer',
    source: 'referral', pipelineStage: 'new', tags: [], createdAt: '2026-08-11T00:00:00.000Z',
  };
}

export function createSampleSmartListCliContext(): SmartListCliContext {
  const sample: SmartList = {
    id: 'smart-list-sample-hot', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, name: 'Hot leads',
    definition: {
      schemaVersion: SMART_LIST_SCHEMA_VERSION,
      criteria: [{ field: 'leadType', operator: 'eq', value: 'hot' }],
    },
    status: 'active', createdByMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
    createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
  };
  return {
    repository: createMemorySmartListRepository({ initialLists: [sample] }),
    contacts: { list: async () => [sampleContact('contact-hot', 'hot'), sampleContact('contact-warm', 'warm')] },
    scope: SAMPLE_WORKSPACE_SCOPE,
  };
}

export async function createLiveSmartListCliContext(): Promise<SmartListCliContext> {
  const { client, scope } = await createAuthenticatedCliContext();
  const repository = supabaseRepository(client, scope);
  return {
    repository: supabaseSmartListRepository(client),
    contacts: { list: async () => repository.list() },
    scope,
  };
}

async function execute(selected: Options, context: SmartListCliContext, now: Date): Promise<unknown> {
  if (selected.command === 'create') return createSmartListCommand(context.repository, context.scope, {
    name: selected.name,
    definition: parseJsonOption(selected.definitionJson, '--definition-json'),
  }, now);
  if (selected.command === 'list') return listSmartListsCommand(context.repository, context.scope, selected.status);
  if (selected.command === 'show') return showSmartListCommand(context.repository, context.scope, selected.id);
  if (selected.command === 'apply') return applySmartListCommand(context.repository, context.contacts, context.scope, selected.id);
  if (selected.command === 'update') return updateSmartListCommand(context.repository, context.scope, selected.id, {
    ...(selected.name === undefined ? {} : { name: selected.name }),
    ...(selected.definitionJson === undefined ? {} : {
      definition: parseJsonOption(selected.definitionJson, '--definition-json'),
    }),
  }, now);
  if (selected.command === 'archive') {
    return archiveSmartListCommand(context.repository, context.scope, selected.id, selected.reason, now);
  }
  return restoreSmartListCommand(context.repository, context.scope, selected.id, now);
}

export async function runSmartListCli(argv: readonly string[], dependencies: SmartListCliDependencies = {}): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    const context = live
      ? await (dependencies.liveContext ?? createLiveSmartListCliContext)()
      : (dependencies.sampleContext ?? createSampleSmartListCliContext)();
    const result = await execute(selected, context, (dependencies.now ?? (() => new Date()))());
    return writeCliEnvelope(dependencies, {
      ok: true, resource: 'smart-lists', command: selected.command, live, result,
    });
  } catch (error) {
    return writeCliEnvelope(dependencies, { ok: false, resource: 'smart-lists', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runSmartListCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
