#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  archiveTaskCommand,
  completeTaskCommand,
  createTaskCommand,
  listActivityEventsCommand,
  listTasksCommand,
  reopenTaskCommand,
  transitionTasksCommand,
} from '../lib/application/activity-commands.ts';
import { createMemoryActivityRepository } from '../lib/data/memory-activity-repository.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseActivityRepository } from '../lib/data/supabase-activity-repository.ts';
import type { ActivityRepository } from '../lib/data/activity-repository.ts';
import type { ActivityEvent, CrmTask, TaskStatus } from '../lib/domain/activity.ts';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  commaIds,
  optionValue,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

export type ActivityCliCommand =
  | 'tasks'
  | 'events'
  | 'create'
  | 'complete'
  | 'reopen'
  | 'archive'
  | 'bulk-complete'
  | 'bulk-archive';

interface Options {
  command: ActivityCliCommand;
  live: boolean;
  id?: string;
  ids?: string;
  query?: string;
  contactId?: string;
  assigneeMembershipId?: string;
  status?: TaskStatus | 'all';
  from?: string;
  to?: string;
  limit?: string;
  title?: string;
  description?: string;
  dueAt?: string;
  idempotencyKey?: string;
}

export interface ActivityCliContext {
  repository: ActivityRepository;
  scope: WorkspaceScope;
}

export interface ActivityCliDependencies extends CliOutput {
  readonly sampleContext?: () => ActivityCliContext;
  readonly liveContext?: () => Promise<ActivityCliContext>;
  readonly now?: () => Date;
}

const COMMANDS: readonly ActivityCliCommand[] = [
  'tasks', 'events', 'create', 'complete', 'reopen', 'archive', 'bulk-complete', 'bulk-archive',
];

function usage(): string {
  return [
    'Usage: npm run activities -- <command> [options] [--live]',
    'Commands:',
    '  tasks [--query <text>] [--status open|completed|archived|all] [--contact-id <id>]',
    '        [--from <ISO>] [--to <ISO>] [--limit <1-500>]',
    '  events [--contact-id <id>] [--from <ISO>] [--to <ISO>] [--limit <1-500>]',
    '  create --title <text> --due-at <ISO> --idempotency-key <key>',
    '         [--description <text>] [--contact-id <id>] [--assignee-membership-id <id>]',
    '  complete|reopen|archive --id <task-id>',
    '  bulk-complete|bulk-archive --ids <id,id,...>  (1–100 explicit IDs)',
    'Default mode is explicit, non-durable sample data. JSON output is stable v1.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as ActivityCliCommand)) cliUsageError(usage());
  const selected: Options = { command: argv[0] as ActivityCliCommand, live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--id') selected.id = optionValue(argv, index++, '--id');
    else if (argument === '--ids') selected.ids = optionValue(argv, index++, '--ids');
    else if (argument === '--query') selected.query = optionValue(argv, index++, '--query');
    else if (argument === '--contact-id') selected.contactId = optionValue(argv, index++, '--contact-id');
    else if (argument === '--assignee-membership-id') {
      selected.assigneeMembershipId = optionValue(argv, index++, '--assignee-membership-id');
    } else if (argument === '--from') selected.from = optionValue(argv, index++, '--from');
    else if (argument === '--to') selected.to = optionValue(argv, index++, '--to');
    else if (argument === '--limit') selected.limit = optionValue(argv, index++, '--limit');
    else if (argument === '--title') selected.title = optionValue(argv, index++, '--title');
    else if (argument === '--description') selected.description = optionValue(argv, index++, '--description');
    else if (argument === '--due-at') selected.dueAt = optionValue(argv, index++, '--due-at');
    else if (argument === '--idempotency-key') selected.idempotencyKey = optionValue(argv, index++, '--idempotency-key');
    else if (argument === '--status') {
      const status = optionValue(argv, index++, '--status');
      if (status !== 'open' && status !== 'completed' && status !== 'archived' && status !== 'all') {
        cliUsageError('Status is invalid.');
      }
      selected.status = status;
    } else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return selected;
}

const sampleTask: CrmTask = {
  id: 'task-sample-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, contactId: 'contact-sample-1',
  title: 'Review sample lead', dueAt: '2026-08-12T14:00:00.000Z', status: 'open',
  creatorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
  assigneeMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
  createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
};

const sampleEvent: ActivityEvent = {
  id: 'activity-sample-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
  type: 'task-created', contactId: 'contact-sample-1', taskId: sampleTask.id,
  actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
  occurredAt: '2026-08-11T00:00:00.000Z', createdAt: '2026-08-11T00:00:00.000Z',
  idempotencyKey: 'sample-task-created-1',
};

export function createSampleActivityCliContext(): ActivityCliContext {
  return {
    repository: createMemoryActivityRepository({ initialTasks: [sampleTask], initialEvents: [sampleEvent] }),
    scope: SAMPLE_WORKSPACE_SCOPE,
  };
}

export async function createLiveActivityCliContext(): Promise<ActivityCliContext> {
  const { client, scope } = await createAuthenticatedCliContext();
  return { repository: supabaseActivityRepository(client), scope };
}

async function execute(selected: Options, context: ActivityCliContext, now: Date): Promise<unknown> {
  if (selected.command === 'tasks') return listTasksCommand(context.repository, context.scope, {
    query: selected.query,
    contactId: selected.contactId,
    assigneeMembershipId: selected.assigneeMembershipId,
    status: selected.status,
    dueFrom: selected.from,
    dueTo: selected.to,
    limit: selected.limit,
  });
  if (selected.command === 'events') return listActivityEventsCommand(context.repository, context.scope, {
    contactId: selected.contactId,
    from: selected.from,
    to: selected.to,
    limit: selected.limit,
  });
  if (selected.command === 'create') return createTaskCommand(context.repository, context.scope, {
    title: selected.title,
    description: selected.description,
    dueAt: selected.dueAt,
    contactId: selected.contactId,
    assigneeMembershipId: selected.assigneeMembershipId,
    idempotencyKey: selected.idempotencyKey,
  }, now);
  if (selected.command === 'complete') return completeTaskCommand(context.repository, context.scope, selected.id, now);
  if (selected.command === 'reopen') return reopenTaskCommand(context.repository, context.scope, selected.id, now);
  if (selected.command === 'archive') return archiveTaskCommand(context.repository, context.scope, selected.id, now);
  return transitionTasksCommand(
    context.repository,
    context.scope,
    commaIds(selected.ids),
    selected.command === 'bulk-complete' ? 'complete' : 'archive',
    now,
  );
}

export async function runActivityCli(
  argv: readonly string[],
  dependencies: ActivityCliDependencies = {},
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
      ? await (dependencies.liveContext ?? createLiveActivityCliContext)()
      : (dependencies.sampleContext ?? createSampleActivityCliContext)();
    const result = await execute(selected, context, (dependencies.now ?? (() => new Date()))());
    return writeCliEnvelope(dependencies, {
      ok: true, resource: 'activities', command: selected.command, live, result,
    });
  } catch (error) {
    return writeCliEnvelope(dependencies, { ok: false, resource: 'activities', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runActivityCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
