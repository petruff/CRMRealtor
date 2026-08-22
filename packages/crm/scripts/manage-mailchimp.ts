#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  loadConnectorRuntimeConfiguration,
  loadMailchimpConfiguredRuntimeConfiguration,
} from '../lib/config/connector-runtime.ts';
import {
  previewMailchimpTagSyncCommand,
  selectMailchimpAudienceCommand,
  listLiveMailchimpAudiencesCommand,
  persistMailchimpAudienceSelectionCommand,
  probeLiveMailchimpConnectionCommand,
  setupMailchimpSignedWebhookCommand,
} from '../lib/application/mailchimp-commands.ts';
import {
  beginMailchimpOAuth,
  completeMailchimpOAuth,
} from '../lib/application/mailchimp-oauth-service.ts';
import { disconnectConnectorCommand } from '../lib/application/connector-commands.ts';
import { ConnectorError } from '../lib/domain/connector.ts';
import type { MailchimpAudienceBinding, MailchimpLeadType } from '../lib/domain/mailchimp.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../lib/domain/workspace.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { createMailchimpOperationServerRepository, createMailchimpServerRepository } from '../lib/data/mailchimp-operation-server-context.ts';
import { createMailchimpOAuthServerRepository } from '../lib/data/mailchimp-oauth-server-context.ts';
import { supabaseConnectorRepository } from '../lib/data/supabase-connector-repository.ts';
import { requestMailchimpReconciliationCommand } from '../lib/application/mailchimp-reconciliation-service.ts';
import {
  approveMailchimpOutboundBackfillCommand,
  previewMailchimpOutboundBackfillCommand,
} from '../lib/application/mailchimp-outbound-backfill-service.ts';
import { MailchimpMarketingClient } from '../lib/providers/mailchimp-client.ts';
import { loadMailchimpOAuthConfiguration } from '../lib/providers/mailchimp-client.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  parseJsonOption,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

type MailchimpCommand = 'status' | 'probe' | 'mapping' | 'oauth-start' | 'oauth-complete' | 'audiences' | 'select-audience' | 'setup-webhook' | 'baseline' | 'preview' | 'preview-backfill' | 'approve-backfill' | 'reconcile' | 'disconnect';

interface Options {
  readonly command: MailchimpCommand;
  readonly live: boolean;
  readonly connectionId?: string;
  readonly accountIdHash?: string;
  readonly dataCenter?: string;
  readonly audienceJson?: string;
  readonly bindingJson?: string;
  readonly contactsJson?: string;
  readonly limit?: string;
  readonly offset?: string;
  readonly state?: string;
  readonly code?: string;
  readonly runId?: string;
  readonly snapshotHash?: string;
  readonly mappingVersion?: string;
  readonly mode?: string;
  readonly requestKey?: string;
}

export interface MailchimpCliDependencies extends CliOutput {
  readonly now?: () => Date;
  readonly liveList?: (input: { connectionId: string; limit: number }) => Promise<unknown>;
  readonly liveSelect?: (input: { connectionId: string; audienceId: string }) => Promise<unknown>;
  readonly liveOAuthStart?: () => Promise<unknown>;
  readonly liveOAuthComplete?: (input: { state: string; code: string }) => Promise<unknown>;
  readonly liveHealth?: (connectionId: string) => Promise<unknown>;
  readonly liveProbe?: (connectionId: string) => Promise<unknown>;
  readonly liveBackfillPreview?: (input: { connectionId: string; mode: 'backfill' | 'tag-reconcile'; limit: number; requestKey?: string }) => Promise<unknown>;
  readonly liveBackfillApprove?: (input: { runId: string; snapshotHash: string; mappingVersion: number }) => Promise<unknown>;
  readonly liveWebhookSetup?: (input: { connectionId: string }) => Promise<unknown>;
  readonly liveBaseline?: (input: { connectionId: string; offset: number; limit: number }) => Promise<unknown>;
  readonly liveReconcileRequest?: (input: { connectionId: string; limit: number }) => Promise<unknown>;
  readonly privilegedReconcile?: () => Promise<unknown>;
  readonly liveDisconnect?: (connectionId: string) => Promise<unknown>;
}

const commands: readonly MailchimpCommand[] = [
  'status', 'probe', 'mapping', 'oauth-start', 'oauth-complete', 'audiences', 'select-audience', 'setup-webhook', 'baseline', 'preview', 'preview-backfill', 'approve-backfill', 'reconcile', 'disconnect',
];

function usage(): string {
  return [
    'Usage: npm run mailchimp -- <command> [options] [--live]',
    'Commands:',
    '  status [--live --connection-id <id>]',
    '  probe --live --connection-id <id>',
    '  mapping',
    '  oauth-start --live',
    '  oauth-complete --live --state <state> --code <one-time-code>',
    '  audiences --live --connection-id <id> [--limit <1-500>]',
    '  select-audience --connection-id <id> --account-id-hash <sha256> --data-center <dc> --audience-json <json>',
    '  select-audience --live --connection-id <id> --audience-json <{"id":"..."}>',
    '  setup-webhook --live --connection-id <id>',
    '  baseline --live --connection-id <id> [--limit <1-500>]',
    '  preview --binding-json <json> --contacts-json <[{normalizedEmail,leadType}]>',
    '  preview-backfill --live --connection-id <id> [--mode backfill|tag-reconcile] [--limit <1-500>] [--request-key <key>]',
    '  approve-backfill --live --run-id <id> --snapshot-hash <sha256> --mapping-version <n>',
    '  reconcile --live --connection-id <id> [--limit <1-500>]',
    '  disconnect --live --connection-id <id>',
    'CLI OAuth requires OMNIX_MAILCHIMP_OAUTH_SESSION_SECRET (43-256 URL-safe chars); it is never printed.',
    'Live operations fail closed until provider credentials are configured.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { readonly help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!commands.includes(argv[0] as MailchimpCommand)) cliUsageError(usage());
  const result: Record<string, unknown> = { command: argv[0], live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') result.live = true;
    else if (argument === '--connection-id') result.connectionId = optionValue(argv, index++, argument);
    else if (argument === '--account-id-hash') result.accountIdHash = optionValue(argv, index++, argument);
    else if (argument === '--data-center') result.dataCenter = optionValue(argv, index++, argument);
    else if (argument === '--audience-json') result.audienceJson = optionValue(argv, index++, argument);
    else if (argument === '--binding-json') result.bindingJson = optionValue(argv, index++, argument);
    else if (argument === '--contacts-json') result.contactsJson = optionValue(argv, index++, argument);
    else if (argument === '--limit') result.limit = optionValue(argv, index++, argument);
    else if (argument === '--offset') result.offset = optionValue(argv, index++, argument);
    else if (argument === '--state') result.state = optionValue(argv, index++, argument);
    else if (argument === '--code') result.code = optionValue(argv, index++, argument);
    else if (argument === '--run-id') result.runId = optionValue(argv, index++, argument);
    else if (argument === '--snapshot-hash') result.snapshotHash = optionValue(argv, index++, argument);
    else if (argument === '--mapping-version') result.mappingVersion = optionValue(argv, index++, argument);
    else if (argument === '--mode') result.mode = optionValue(argv, index++, argument);
    else if (argument === '--request-key') result.requestKey = optionValue(argv, index++, argument);
    else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return result as unknown as Options;
}

function contacts(value: unknown): readonly { normalizedEmail: string; leadType: MailchimpLeadType }[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new ConnectorError('invalid-input', 'contactsJson must contain 0–500 contacts.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ConnectorError('invalid-input', 'Mailchimp preview contact is invalid.');
    }
    const row = item as Record<string, unknown>;
    if (typeof row.normalizedEmail !== 'string' || !['hot', 'warm', 'nurture'].includes(String(row.leadType))) {
      throw new ConnectorError('invalid-input', 'Mailchimp preview contact is invalid.');
    }
    return { normalizedEmail: row.normalizedEmail, leadType: row.leadType as MailchimpLeadType };
  });
}

function executeSample(selected: Options, now: Date): unknown {
  const configuration = loadConnectorRuntimeConfiguration();
  const definition = configuration.definitions.find((item) => item.provider === 'mailchimp');
  if (selected.command === 'status') return {
    provider: 'mailchimp',
    enabled: definition?.enabled === true,
    mode: definition?.mode ?? 'provider-disabled',
    productionRequirements: definition?.productionRequirements ?? [],
  };
  if (selected.command === 'mapping') return {
    mappingVersion: 1,
    sourceOfTruth: 'omnix-lead-type',
    tags: { hot: 'Omnix: Hot', warm: 'Omnix: Warm', nurture: 'Omnix: Nurture' },
    subscriptionAuthority: 'mailchimp',
  };
  if (selected.command === 'select-audience') return selectMailchimpAudienceCommand(SAMPLE_WORKSPACE_SCOPE, {
    connectionId: selected.connectionId,
    accountIdHash: selected.accountIdHash,
    dataCenter: selected.dataCenter,
    audience: parseJsonOption(selected.audienceJson, '--audience-json'),
  }, now);
  if (selected.command === 'preview') return previewMailchimpTagSyncCommand({
    binding: parseJsonOption(selected.bindingJson, '--binding-json') as MailchimpAudienceBinding,
    contacts: contacts(parseJsonOption(selected.contactsJson, '--contacts-json')),
  });
  throw new ConnectorError('invalid-input', 'Mailchimp command is invalid.');
}

async function defaultLiveList(input: { connectionId: string; limit: number }) {
  const { client, scope } = await createAuthenticatedCliContext();
  const operations = createMailchimpOperationServerRepository({ authenticated: client });
  return listLiveMailchimpAudiencesCommand(
    operations,
    loadMailchimpConfiguredRuntimeConfiguration(),
    scope,
    input,
    { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
  );
}

async function defaultLiveSelect(input: { connectionId: string; audienceId: string }) {
  const { client, scope } = await createAuthenticatedCliContext();
  const operations = createMailchimpOperationServerRepository({ authenticated: client });
  const configuration = loadMailchimpConfiguredRuntimeConfiguration();
  const audiences = await listLiveMailchimpAudiencesCommand(
    operations,
    configuration,
    scope,
    { connectionId: input.connectionId, limit: 500 },
    { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
  );
  const audience = audiences.find((candidate) => candidate.id === input.audienceId);
  if (!audience) throw new ConnectorError('not-found', 'Mailchimp audience was not found in the connected account.');
  return persistMailchimpAudienceSelectionCommand(operations, configuration, scope, {
    connectionId: input.connectionId, audience, correlationId: randomUUID(),
  });
}

function oauthSessionSecret(): string {
  const value = process.env.OMNIX_MAILCHIMP_OAUTH_SESSION_SECRET?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(value)) {
    throw new ConnectorError(
      'configuration-required',
      'Set OMNIX_MAILCHIMP_OAUTH_SESSION_SECRET to a private 43–256 character URL-safe value.',
    );
  }
  return value;
}

async function defaultLiveOAuthStart() {
  const { client, scope } = await createAuthenticatedCliContext();
  return beginMailchimpOAuth({
    repository: createMailchimpOAuthServerRepository({ authenticated: client }),
    scope,
    actorUserId: scope.authenticatedUserId,
    sessionSecret: oauthSessionSecret(),
    safeReturnPath: '/connections',
    configuration: loadMailchimpOAuthConfiguration(),
  });
}

async function defaultLiveOAuthComplete(input: { state: string; code: string }) {
  const { client, scope } = await createAuthenticatedCliContext();
  return completeMailchimpOAuth({
    repository: createMailchimpOAuthServerRepository({ authenticated: client }),
    scope,
    actorUserId: scope.authenticatedUserId,
    sessionSecret: oauthSessionSecret(),
    state: input.state,
    code: input.code,
    configuration: loadMailchimpOAuthConfiguration(),
  });
}

async function defaultLiveHealth(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  const configuration = loadMailchimpConfiguredRuntimeConfiguration();
  const connectorRepository = supabaseConnectorRepository(client, configuration.definitions);
  const connection = await connectorRepository.getConnection(scope, connectionId);
  if (!connection || connection.provider !== 'mailchimp') {
    throw new ConnectorError('not-found', 'Mailchimp connection was not found in this workspace.');
  }
  const server = createMailchimpServerRepository({ authenticated: client });
  const audience = await server.operations.getSelectedAudience(scope, connectionId);
  const runs = await server.reconciliations.list(scope, connectionId, 1);
  const setup = audience ? await server.operations.readSetupState(connectionId) : undefined;
  const lastRun = runs[0];
  return {
    provider: 'mailchimp',
    connection: {
      id: connection.id,
      status: connection.status,
      accountIdHash: connection.remoteAccountId,
      accountLabel: connection.remoteAccountLabel,
      grantedScopes: connection.grantedScopes,
      lastProbeAt: connection.tokenUpdatedAt,
    },
    audience: audience ? {
      id: audience.audienceId,
      name: audience.audienceName,
      dataCenter: audience.dataCenter,
      mappingVersion: audience.mappingVersion,
      baselineRequired: audience.baselineRequired,
    } : null,
    webhook: setup ? {
      endpointBound: setup.endpointBound,
      registrationRequired: setup.webhookRegistrationRequired,
      secretVersion: setup.secretVersion,
    } : null,
    lastReconciliation: lastRun ? {
      id: lastRun.id,
      mode: lastRun.mode,
      state: lastRun.state,
      pagesApplied: lastRun.pagesApplied,
      itemsSeen: lastRun.itemsSeen,
      itemsApplied: lastRun.itemsApplied,
      itemsReviewed: lastRun.itemsReviewed,
      itemsBlocked: lastRun.itemsBlocked,
    } : null,
  };
}

async function defaultLiveWebhookSetup(input: { connectionId: string }) {
  const { client, scope } = await createAuthenticatedCliContext();
  const operations = createMailchimpOperationServerRepository({ authenticated: client });
  return setupMailchimpSignedWebhookCommand(
    operations,
    loadMailchimpConfiguredRuntimeConfiguration(),
    scope,
    {
      connectionId: input.connectionId,
      webhookBaseUrl: process.env.MAILCHIMP_WEBHOOK_BASE_URL ?? '',
      correlationId: randomUUID(),
    },
    { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
  );
}

async function defaultLiveProbe(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  const operations = createMailchimpOperationServerRepository({ authenticated: client });
  return probeLiveMailchimpConnectionCommand(
    operations,
    loadMailchimpConfiguredRuntimeConfiguration(),
    scope,
    { connectionId, correlationId: randomUUID() },
    { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
  );
}

async function defaultLiveBackfillPreview(input: { connectionId: string; mode: 'backfill' | 'tag-reconcile'; limit: number; requestKey?: string }) {
  const { client, scope } = await createAuthenticatedCliContext();
  const server = createMailchimpServerRepository({ authenticated: client });
  return previewMailchimpOutboundBackfillCommand(
    server.outboundBackfills,
    loadMailchimpConfiguredRuntimeConfiguration(),
    scope,
    { connectionId: input.connectionId, mode: input.mode, pageSize: input.limit, requestKey: input.requestKey },
  );
}

async function defaultLiveBackfillApprove(input: { runId: string; snapshotHash: string; mappingVersion: number }) {
  const { client, scope } = await createAuthenticatedCliContext();
  const server = createMailchimpServerRepository({ authenticated: client });
  return approveMailchimpOutboundBackfillCommand(
    server.outboundBackfills,
    loadMailchimpConfiguredRuntimeConfiguration(),
    scope,
    input,
  );
}

async function defaultLiveBaseline(input: { connectionId: string; offset: number; limit: number }) {
  if (input.offset !== 0) {
    throw new ConnectorError('invalid-input', 'Durable baseline requests always resume from their persisted checkpoint; --offset must be 0.');
  }
  const { client, scope } = await createAuthenticatedCliContext();
  const server = createMailchimpServerRepository({ authenticated: client });
  return requestMailchimpReconciliationCommand(server.operations, server.reconciliations, scope, {
    connectionId: input.connectionId,
    mode: 'baseline',
    pageSize: input.limit,
    correlationId: randomUUID(),
  });
}

async function defaultLiveReconcileRequest(input: { connectionId: string; limit: number }) {
  const { client, scope } = await createAuthenticatedCliContext();
  const server = createMailchimpServerRepository({ authenticated: client });
  return requestMailchimpReconciliationCommand(server.operations, server.reconciliations, scope, {
    connectionId: input.connectionId,
    mode: 'reconcile',
    pageSize: input.limit,
    correlationId: randomUUID(),
  });
}

async function defaultLiveDisconnect(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  const configuration = loadMailchimpConfiguredRuntimeConfiguration();
  const repository = supabaseConnectorRepository(client, configuration.definitions);
  return disconnectConnectorCommand(repository, scope, { connectionId, correlationId: randomUUID() });
}

async function executeLive(selected: Options, dependencies: MailchimpCliDependencies): Promise<unknown> {
  const connectionId = selected.connectionId?.trim() ?? '';
  if (selected.command === 'status') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required for live status.');
    return (dependencies.liveHealth ?? defaultLiveHealth)(connectionId);
  }
  if (selected.command === 'probe') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    return (dependencies.liveProbe ?? defaultLiveProbe)(connectionId);
  }
  if (selected.command === 'preview-backfill') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    const limit = selected.limit === undefined ? 100 : Number(selected.limit);
    const mode = selected.mode ?? 'backfill';
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !['backfill', 'tag-reconcile'].includes(mode)) {
      throw new ConnectorError('invalid-input', 'Backfill preview options are invalid.');
    }
    return (dependencies.liveBackfillPreview ?? defaultLiveBackfillPreview)({
      connectionId, mode: mode as 'backfill' | 'tag-reconcile', limit,
      ...(selected.requestKey ? { requestKey: selected.requestKey } : {}),
    });
  }
  if (selected.command === 'approve-backfill') {
    const mappingVersion = Number(selected.mappingVersion);
    if (!selected.runId || !selected.snapshotHash || !Number.isInteger(mappingVersion) || mappingVersion < 1) {
      throw new ConnectorError('invalid-input', '--run-id, --snapshot-hash and --mapping-version are required.');
    }
    return (dependencies.liveBackfillApprove ?? defaultLiveBackfillApprove)({
      runId: selected.runId, snapshotHash: selected.snapshotHash, mappingVersion,
    });
  }
  if (selected.command === 'oauth-start') {
    return (dependencies.liveOAuthStart ?? defaultLiveOAuthStart)();
  }
  if (selected.command === 'oauth-complete') {
    const state = selected.state?.trim() ?? '';
    const code = selected.code?.trim() ?? '';
    if (!state || !code) throw new ConnectorError('invalid-input', '--state and --code are required.');
    return (dependencies.liveOAuthComplete ?? defaultLiveOAuthComplete)({ state, code });
  }
  if (selected.command === 'audiences') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    const limit = selected.limit === undefined ? 100 : Number(selected.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ConnectorError('invalid-input', '--limit must be 1–500.');
    return (dependencies.liveList ?? defaultLiveList)({ connectionId, limit });
  }
  if (selected.command === 'select-audience') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    const audience = parseJsonOption(selected.audienceJson, '--audience-json') as { id?: unknown };
    if (!audience || typeof audience !== 'object' || typeof audience.id !== 'string') {
      throw new ConnectorError('invalid-input', '--audience-json must contain a provider audience id.');
    }
    return (dependencies.liveSelect ?? defaultLiveSelect)({ connectionId, audienceId: audience.id });
  }
  if (selected.command === 'setup-webhook') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    return (dependencies.liveWebhookSetup ?? defaultLiveWebhookSetup)({ connectionId });
  }
  if (selected.command === 'baseline') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    const offset = selected.offset === undefined ? 0 : Number(selected.offset);
    const limit = selected.limit === undefined ? 100 : Number(selected.limit);
    if (offset !== 0) {
      throw new ConnectorError('invalid-input', 'Durable baseline requests resume from their persisted checkpoint; --offset must be 0.');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ConnectorError('invalid-input', '--limit must be 1–500.');
    }
    return (dependencies.liveBaseline ?? defaultLiveBaseline)({ connectionId, offset, limit });
  }
  if (selected.command === 'reconcile') {
    if (dependencies.privilegedReconcile) return dependencies.privilegedReconcile();
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    const limit = selected.limit === undefined ? 100 : Number(selected.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ConnectorError('invalid-input', '--limit must be 1–500.');
    }
    return (dependencies.liveReconcileRequest ?? defaultLiveReconcileRequest)({ connectionId, limit });
  }
  if (selected.command === 'disconnect') {
    if (!connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    return (dependencies.liveDisconnect ?? defaultLiveDisconnect)(connectionId);
  }
  throw new ConnectorError('provider-disabled', 'This Mailchimp command has no live execution path.');
}

export async function runMailchimpCli(
  argv: readonly string[],
  output: MailchimpCliDependencies = {},
): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (output.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    const result = selected.live
      ? await executeLive(selected, output)
      : executeSample(selected, (output.now ?? (() => new Date()))());
    return writeCliEnvelope(output, {
      ok: true,
      resource: 'connectors',
      command: `mailchimp.${selected.command}`,
      live,
      result,
    });
  } catch (error) {
    return writeCliEnvelope(output, { ok: false, resource: 'connectors', command: 'mailchimp', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runMailchimpCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
