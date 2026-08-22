#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { searchCrm, type CrmSearchContext } from '../lib/application/crm-search-service.ts';
import { getPipelineAnalytics, type PipelineAnalyticsContext } from '../lib/application/pipeline-analytics-service.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { memoryRepository } from '../lib/data/memory-repository.ts';
import { createMemoryActivityRepository } from '../lib/data/memory-activity-repository.ts';
import { createMemoryIncompleteRecordRepository } from '../lib/data/memory-incomplete-record-repository.ts';
import { createMemorySmartListRepository } from '../lib/data/memory-smart-list-repository.ts';
import { memoryMailerRepository } from '../lib/data/memory-mailer-repository.ts';
import { createSampleWorkspaceRepository } from '../lib/data/memory-workspace-repository.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseActivityRepository } from '../lib/data/supabase-activity-repository.ts';
import { supabaseIncompleteRecordRepository } from '../lib/data/supabase-incomplete-record-repository.ts';
import { supabaseSmartListRepository } from '../lib/data/supabase-smart-list-repository.ts';
import { supabaseMailerRepository } from '../lib/data/supabase-mailer-repository.ts';
import { supabaseWorkspaceRepository } from '../lib/data/supabase-workspace-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../lib/domain/workspace.ts';

type Context = CrmSearchContext & PipelineAnalyticsContext;

function usage(): string {
  return [
    'Usage: npm run crm -- search --query <text> [--limit <1-50>] [--live]',
    '       npm run crm -- insights [--from <ISO>] [--to <ISO>] [--live]',
    'Search covers contacts, tasks, incomplete records, Smart Lists, mailers, and members.',
    'Sample mode is process-local; --live requires end-user Supabase credentials.',
  ].join('\n');
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function sampleContext(): Context {
  const repository = memoryRepository();
  const activityRepository = createMemoryActivityRepository();
  return {
    repository, activityRepository,
    incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
    smartListRepository: createMemorySmartListRepository(),
    mailerRepository: memoryMailerRepository(repository),
    workspaceRepository: createSampleWorkspaceRepository(true),
    workspaceScope: SAMPLE_WORKSPACE_SCOPE,
  };
}

async function liveContext(): Promise<Context> {
  const { client, scope } = await createAuthenticatedCliContext();
  return {
    repository: supabaseRepository(client, scope),
    activityRepository: supabaseActivityRepository(client),
    incompleteRecordRepository: supabaseIncompleteRecordRepository(client),
    smartListRepository: supabaseSmartListRepository(client),
    mailerRepository: supabaseMailerRepository(client, scope),
    workspaceRepository: supabaseWorkspaceRepository(client),
    workspaceScope: scope,
  };
}

export async function runCrmCli(argv: readonly string[]): Promise<number> {
  const live = argv.includes('--live');
  try {
    const command = argv[0];
    if (!command || command === '--help' || command === '-h') {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (command !== 'search' && command !== 'insights') throw new Error(usage());
    const context = live ? await liveContext() : sampleContext();
    const result = command === 'search'
      ? await searchCrm(context, option(argv, '--query'), Number(option(argv, '--limit') ?? 20))
      : await getPipelineAnalytics(context, { from: option(argv, '--from'), to: option(argv, '--to') });
    process.stdout.write(`${JSON.stringify({ ok: true, schemaVersion: 'crm-navigation-cli.v1', mode: live ? 'live-authenticated' : 'sample-process-only', durable: live, command, result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, schemaVersion: 'crm-navigation-cli.v1', mode: live ? 'live-authenticated' : 'sample-process-only', message: error instanceof Error ? error.message : 'CRM command failed safely.' }, null, 2)}\n`);
    return 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runCrmCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
