#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { createMemoryTransactionRepository } from '../lib/data/memory-transaction-repository.ts';
import { memoryRepository } from '../lib/data/memory-repository.ts';
import { supabaseTransactionRepository } from '../lib/data/supabase-transaction-repository.ts';
import type { TransactionRepository } from '../lib/data/transaction-repository.ts';
import type { AddTransactionPartyInput, ArchiveTransactionPartyInput, CreateRealEstateTransactionInput, TransitionRealEstateTransactionInput, UpdateRealEstateTransactionInput, UpdateTransactionPartyInput } from '../lib/domain/transaction.ts';
import type { UpsertTransactionFinancialAuthorityInput } from '../lib/domain/transaction-finance.ts';
import type { StartWorkflowPlanInput, TransitionWorkflowStepInput } from '../lib/domain/workflow-pack.ts';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';

interface TransactionCliContext {
  readonly repository: TransactionRepository;
  readonly scope: WorkspaceScope;
  readonly mode: 'sample-process-only' | 'live-authenticated';
}

interface TransactionCliOutput {
  write(value: string): void;
  error(value: string): void;
}

const usage = () => [
  'Usage: npm run transactions -- <command> [--payload <json>] [--live]',
  'Commands: list, create, update, transition, party-add, party-update, party-archive, finance-upsert, workflow-packs, workflow-plans, workflow-start, workflow-step.',
  'Mutation payloads use the documented Story 7.1-7.4 domain fields and require an idempotencyKey.',
  'Sample mode is process-local. --live requires end-user Supabase credentials.',
].join('\n');

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const result = argv[index + 1];
  if (!result || result.startsWith('--')) throw new Error(`${name} requires a value.`);
  return result;
}

function payload<T>(argv: readonly string[]): T {
  const raw = option(argv, '--payload');
  if (!raw) throw new Error('--payload is required for mutation commands.');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--payload must be a JSON object.');
  return parsed as T;
}

async function defaultContext(live: boolean): Promise<TransactionCliContext> {
  if (live) {
    const { client, scope } = await createAuthenticatedCliContext();
    return { repository: supabaseTransactionRepository(client), scope, mode: 'live-authenticated' };
  }
  const contacts = memoryRepository();
  return { repository: createMemoryTransactionRepository(contacts), scope: SAMPLE_WORKSPACE_SCOPE, mode: 'sample-process-only' };
}

export async function runTransactionCli(
  argv: readonly string[],
  output: TransactionCliOutput = { write: (value) => process.stdout.write(value), error: (value) => process.stderr.write(value) },
  contextFactory: (live: boolean) => Promise<TransactionCliContext> = defaultContext,
): Promise<number> {
  const live = argv.includes('--live');
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    output.write(`${usage()}\n`);
    return 0;
  }
  try {
    const context = await contextFactory(live);
    const occurredAt = new Date().toISOString();
    let result: unknown;
    switch (command) {
      case 'list': {
        const transactions = await context.repository.list(context.scope);
        const parties = await context.repository.listParties(context.scope, transactions.map((item) => item.id));
        const financials = await context.repository.listFinancials(context.scope, transactions.map((item) => item.id));
        const workflowPlans = await context.repository.listWorkflowPlans(context.scope, transactions.map((item) => item.id));
        result = { transactions, parties, financials, workflowPlans };
        break;
      }
      case 'create':
        result = await context.repository.create(context.scope, payload<CreateRealEstateTransactionInput>(argv));
        break;
      case 'update':
        result = await context.repository.update(context.scope, payload<UpdateRealEstateTransactionInput>(argv), occurredAt);
        break;
      case 'transition':
        result = await context.repository.transition(context.scope, payload<TransitionRealEstateTransactionInput>(argv), occurredAt);
        break;
      case 'party-add':
        result = await context.repository.addParty(context.scope, payload<AddTransactionPartyInput>(argv), occurredAt);
        break;
      case 'party-update':
        result = await context.repository.updateParty(context.scope, payload<UpdateTransactionPartyInput>(argv), occurredAt);
        break;
      case 'party-archive':
        result = await context.repository.archiveParty(context.scope, payload<ArchiveTransactionPartyInput>(argv), occurredAt);
        break;
      case 'finance-upsert':
        result = await context.repository.upsertFinancials(context.scope, payload<UpsertTransactionFinancialAuthorityInput>(argv), occurredAt);
        break;
      case 'workflow-packs':
        result = await context.repository.listWorkflowPacks(context.scope);
        break;
      case 'workflow-plans': {
        const plans = await context.repository.listWorkflowPlans(context.scope);
        result = { plans, steps: await context.repository.listWorkflowSteps(context.scope, plans.map((item) => item.id)) };
        break;
      }
      case 'workflow-start':
        result = await context.repository.startWorkflowPlan(context.scope, payload<StartWorkflowPlanInput>(argv), occurredAt);
        break;
      case 'workflow-step':
        result = await context.repository.transitionWorkflowStep(context.scope, payload<TransitionWorkflowStepInput>(argv), occurredAt);
        break;
      default:
        throw new Error(usage());
    }
    output.write(`${JSON.stringify({ ok: true, schemaVersion: 'omnix-transactions-cli.v1', mode: context.mode, durable: live, command, result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    output.error(`${JSON.stringify({
      ok: false,
      schemaVersion: 'omnix-transactions-cli.v1',
      mode: live ? 'live-authenticated' : 'sample-process-only',
      message: error instanceof Error ? error.message : 'Transaction command failed safely.',
      supportRef: randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(),
    }, null, 2)}\n`);
    return 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runTransactionCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
