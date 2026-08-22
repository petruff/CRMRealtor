#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  approveConnectorIntentCommand,
  cancelConnectorJobCommand,
  createConnectorIntentCommand,
  disconnectConnectorCommand,
  editConnectorIntentCommand,
  listConnectorConnectionsCommand,
  listConnectorDefinitionsCommand,
  listConnectorIntentsCommand,
  listConnectorJobsCommand,
  listConnectorReceiptsCommand,
  probeConnectorConnectionCommand,
  rejectConnectorIntentCommand,
  retryConnectorJobCommand,
} from '../lib/application/connector-commands.ts';
import { ContractTestConnectorAdapter, drainConnectorJobs } from '../lib/application/connector-worker.ts';
import { drainConfiguredConnectorServiceJobs } from '../lib/application/connector-service-worker.ts';
import { rewrapConfiguredConnectorKekBatch } from '../lib/application/connector-kek-rewrap.ts';
import {
  loadConnectorRuntimeConfiguration,
  type ConnectorRuntimeConfiguration,
} from '../lib/config/connector-runtime.ts';
import type { ConnectorRepository } from '../lib/data/connector-repository.ts';
import { createMemoryConnectorRepository } from '../lib/data/memory-connector-repository.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseConnectorRepository } from '../lib/data/supabase-connector-repository.ts';
import type { ConnectorConnection, ConnectorProvider } from '../lib/domain/connector.ts';
import { ConnectorError } from '../lib/domain/connector.ts';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '../lib/domain/workspace.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  parseJsonOption,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

export type ConnectorCliCommand =
  | 'definitions'
  | 'connections'
  | 'scopes'
  | 'disconnect'
  | 'intents'
  | 'draft'
  | 'edit'
  | 'approve'
  | 'enqueue'
  | 'reject'
  | 'jobs'
  | 'retry-job'
  | 'cancel-job'
  | 'receipts'
  | 'probe'
  | 'drain'
  | 'reconcile'
  | 'rewrap';

interface Options {
  command: ConnectorCliCommand;
  live: boolean;
  provider?: string;
  connectionId?: string;
  intentId?: string;
  jobId?: string;
  actionType?: string;
  payloadReference?: string;
  payloadJson?: string;
  payloadHash?: string;
  policyId?: string;
  policyVersion?: string;
  complianceJson?: string;
  summary?: string;
  expectedVersion?: string;
  idempotencyKey?: string;
  correlationId?: string;
  state?: string;
  limit?: string;
}

export interface ConnectorCliContext {
  readonly repository: ConnectorRepository;
  readonly scope: WorkspaceScope;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly rewrapSecrets?: () => Promise<unknown>;
}

export interface ConnectorCliDependencies extends CliOutput {
  readonly sampleContext?: () => ConnectorCliContext;
  readonly liveContext?: () => Promise<ConnectorCliContext>;
  readonly now?: () => Date;
  readonly privilegedDrain?: (options?: { readonly reconciliationOnly?: boolean }) => Promise<unknown>;
  readonly privilegedRewrap?: () => Promise<unknown>;
}

const COMMANDS: readonly ConnectorCliCommand[] = [
  'definitions', 'connections', 'scopes', 'disconnect', 'intents', 'draft', 'edit',
  'approve', 'enqueue', 'reject', 'jobs', 'retry-job', 'cancel-job', 'receipts',
  'probe', 'drain', 'reconcile', 'rewrap',
];

function usage(): string {
  return [
    'Usage: npm run connectors -- <command> [options] [--live]',
    'Commands:',
    '  definitions',
    '  connections [--provider <provider>] [--limit <1-500>]',
    '  scopes --connection-id <id>',
    '  disconnect --connection-id <id> [--correlation-id <id>]',
    '  intents [--provider <provider>] [--limit <1-500>]',
    '  draft --provider <provider> --connection-id <id> --action <type> --payload-ref <uuid> --payload-hash <sha256>',
    '        --policy-id <uuid> --policy-version <n> --summary <text> [--compliance-json <json>]',
    '  edit --intent-id <id> --expected-version <n> --payload-ref <uuid> --payload-hash <sha256>',
    '       --policy-id <uuid> --policy-version <n> --summary <text> [--compliance-json <json>]',
    '  approve|enqueue --intent-id <id> --expected-version <n> --idempotency-key <key>',
    '  reject --intent-id <id> --expected-version <n>',
    '  jobs [--provider <provider>] [--state <state|all>] [--limit <1-500>]',
    '  retry-job|cancel-job --job-id <id>',
    '  receipts [--provider <provider>] [--job-id <id>] [--intent-id <id>]',
    '  probe --connection-id <id>  (truthful provider capability check)',
    '  drain|reconcile --live   (server-bound owner context; bounded batch)',
    '  rewrap --live            (server-only KEK rotation operation)',
    'Default mode is explicit, non-durable sample data. Real providers remain disabled.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as ConnectorCliCommand)) cliUsageError(usage());
  const selected: Options = { command: argv[0] as ConnectorCliCommand, live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--provider') selected.provider = optionValue(argv, index++, '--provider');
    else if (argument === '--connection-id') selected.connectionId = optionValue(argv, index++, '--connection-id');
    else if (argument === '--intent-id') selected.intentId = optionValue(argv, index++, '--intent-id');
    else if (argument === '--job-id') selected.jobId = optionValue(argv, index++, '--job-id');
    else if (argument === '--action') selected.actionType = optionValue(argv, index++, '--action');
    else if (argument === '--payload-ref') selected.payloadReference = optionValue(argv, index++, '--payload-ref');
    else if (argument === '--payload-json') selected.payloadJson = optionValue(argv, index++, '--payload-json');
    else if (argument === '--payload-hash') selected.payloadHash = optionValue(argv, index++, '--payload-hash');
    else if (argument === '--policy-id') selected.policyId = optionValue(argv, index++, '--policy-id');
    else if (argument === '--policy-version') selected.policyVersion = optionValue(argv, index++, '--policy-version');
    else if (argument === '--compliance-json') selected.complianceJson = optionValue(argv, index++, '--compliance-json');
    else if (argument === '--summary') selected.summary = optionValue(argv, index++, '--summary');
    else if (argument === '--expected-version') selected.expectedVersion = optionValue(argv, index++, '--expected-version');
    else if (argument === '--idempotency-key') selected.idempotencyKey = optionValue(argv, index++, '--idempotency-key');
    else if (argument === '--correlation-id') selected.correlationId = optionValue(argv, index++, '--correlation-id');
    else if (argument === '--state') selected.state = optionValue(argv, index++, '--state');
    else if (argument === '--limit') selected.limit = optionValue(argv, index++, '--limit');
    else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return selected;
}

const sampleConnection: ConnectorConnection = {
  id: 'connection-contract-test',
  workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
  provider: 'contract-test',
  remoteAccountId: 'contract-test-account',
  remoteAccountLabel: 'Non-live deterministic adapter',
  grantedScopes: ['test.succeed', 'test.ambiguous'],
  status: 'active',
  connectedAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

export function createSampleConnectorCliContext(): ConnectorCliContext {
  const configuration = loadConnectorRuntimeConfiguration({});
  return {
    repository: createMemoryConnectorRepository({
      definitions: configuration.definitions,
      initialConnections: [sampleConnection],
    }),
    scope: SAMPLE_WORKSPACE_SCOPE,
    configuration,
  };
}

export async function createLiveConnectorCliContext(): Promise<ConnectorCliContext> {
  const { client, scope } = await createAuthenticatedCliContext();
  const configuration = loadConnectorRuntimeConfiguration();
  return {
    repository: supabaseConnectorRepository(client, configuration.definitions),
    scope,
    configuration,
  };
}

async function execute(selected: Options, context: ConnectorCliContext, now: Date): Promise<unknown> {
  const { repository, scope, configuration } = context;
  if (selected.command === 'definitions') return listConnectorDefinitionsCommand(repository, scope);
  if (selected.command === 'connections') return listConnectorConnectionsCommand(repository, scope, selected);
  if (selected.command === 'scopes') {
    const connection = await repository.getConnection(scope, selected.connectionId ?? '');
    if (!connection) throw new ConnectorError('not-found', 'Connector connection was not found.');
    return { connectionId: connection.id, provider: connection.provider, status: connection.status, grantedScopes: connection.grantedScopes };
  }
  if (selected.command === 'disconnect') return disconnectConnectorCommand(repository, scope, selected, now);
  if (selected.command === 'intents') return listConnectorIntentsCommand(repository, scope, selected);
  if (selected.command === 'draft') return createConnectorIntentCommand(repository, configuration, scope, {
    provider: selected.provider,
    connectionId: selected.connectionId,
    actionType: selected.actionType,
    payloadReference: selected.payloadReference,
    payload: selected.payloadJson ? parseJsonOption(selected.payloadJson, '--payload-json') : undefined,
    payloadHash: selected.payloadHash,
    policyId: selected.policyId,
    policyVersion: selected.policyVersion,
    complianceSnapshot: selected.complianceJson
      ? parseJsonOption(selected.complianceJson, '--compliance-json')
      : undefined,
    correlationId: selected.correlationId,
    summary: selected.summary,
  }, now);
  if (selected.command === 'edit') return editConnectorIntentCommand(repository, scope, {
    intentId: selected.intentId,
    expectedVersion: selected.expectedVersion,
    payloadReference: selected.payloadReference,
    payload: selected.payloadJson ? parseJsonOption(selected.payloadJson, '--payload-json') : undefined,
    payloadHash: selected.payloadHash,
    policyId: selected.policyId,
    policyVersion: selected.policyVersion,
    complianceSnapshot: selected.complianceJson
      ? parseJsonOption(selected.complianceJson, '--compliance-json')
      : undefined,
    correlationId: selected.correlationId,
    summary: selected.summary,
  }, now);
  if (selected.command === 'approve' || selected.command === 'enqueue') {
    return approveConnectorIntentCommand(repository, scope, selected, now);
  }
  if (selected.command === 'reject') return rejectConnectorIntentCommand(repository, scope, selected, now);
  if (selected.command === 'jobs') return listConnectorJobsCommand(repository, scope, selected);
  if (selected.command === 'retry-job') return retryConnectorJobCommand(repository, scope, selected.jobId, now);
  if (selected.command === 'cancel-job') return cancelConnectorJobCommand(repository, scope, selected.jobId, now);
  if (selected.command === 'receipts') return listConnectorReceiptsCommand(repository, scope, selected);
  if (selected.command === 'probe') {
    return probeConnectorConnectionCommand(repository, configuration, scope, selected);
  }
  if (selected.command === 'rewrap') {
    if (!context.rewrapSecrets) throw new ConnectorError('configuration-required', 'Server-side key rewrap is not configured.');
    return context.rewrapSecrets();
  }
  if (selected.command === 'reconcile' || selected.command === 'drain') {
    return drainConnectorJobs({
      repository,
      scope,
      configuration: selected.command === 'reconcile' ? {
        ...configuration,
        worker: { ...configuration.worker, batchSize: configuration.worker.reconciliationBatchSize },
      } : configuration,
      adapters: new Map<ConnectorProvider, ContractTestConnectorAdapter>([
        ['contract-test', new ContractTestConnectorAdapter()],
      ]),
      workerId: `cli-${selected.command}`,
      now: () => now,
      random: () => 0.5,
    });
  }
  throw new ConnectorError('invalid-input', 'Connector command is invalid.');
}

export async function runConnectorCli(
  argv: readonly string[],
  dependencies: ConnectorCliDependencies = {},
): Promise<number> {
  let live = argv.includes('--live');
  let serverOnly = false;
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    if (selected.live && ['drain', 'reconcile', 'rewrap'].includes(selected.command)) {
      serverOnly = true;
      const operation = selected.command === 'rewrap'
        ? dependencies.privilegedRewrap ?? (() => rewrapConfiguredConnectorKekBatch(process.env))
        : dependencies.privilegedDrain ?? ((options) => drainConfiguredConnectorServiceJobs(process.env, options));
      const result = selected.command === 'rewrap'
        ? await operation()
        : await operation({ reconciliationOnly: selected.command === 'reconcile' });
      return writeCliEnvelope(dependencies, {
        ok: true, resource: 'connectors', command: selected.command, live: true,
        mode: 'live-server-only', result,
      });
    }
    const context = live
      ? await (dependencies.liveContext ?? createLiveConnectorCliContext)()
      : (dependencies.sampleContext ?? createSampleConnectorCliContext)();
    const result = await execute(selected, context, (dependencies.now ?? (() => new Date()))());
    return writeCliEnvelope(dependencies, {
      ok: true, resource: 'connectors', command: selected.command, live, result,
    });
  } catch (error) {
    return writeCliEnvelope(dependencies, {
      ok: false, resource: 'connectors', live,
      ...(serverOnly ? { mode: 'live-server-only' as const } : {}),
      error,
    });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runConnectorCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
