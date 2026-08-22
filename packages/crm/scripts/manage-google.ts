#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  loadConnectorRuntimeConfiguration,
  loadGoogleConfiguredRuntimeConfiguration,
} from '../lib/config/connector-runtime.ts';
import { GOOGLE_BUNDLE_SCOPES, GOOGLE_FEATURE_BUNDLES, parseGoogleFeatureBundle } from '../lib/domain/google-connector.ts';
import { ConnectorError } from '../lib/domain/connector.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { createGoogleOAuthServerRepository } from '../lib/data/google-oauth-server-context.ts';
import { supabaseConnectorRepository } from '../lib/data/supabase-connector-repository.ts';
import { supabaseGoogleOperationRepository } from '../lib/data/supabase-google-operation-repository.ts';
import { createGoogleOperationServerRepository } from '../lib/data/google-operation-server-context.ts';
import { beginGoogleOAuth, completeGoogleOAuth } from '../lib/application/google-oauth-service.ts';
import { disconnectConnectorCommand } from '../lib/application/connector-commands.ts';
import { prepareGoogleCalendarCreationIntent, prepareGoogleSyncIntent } from '../lib/application/google-operations.ts';
import { loadGoogleOAuthConfiguration } from '../lib/providers/google-client.ts';
import { createGoogleProbeServerRepository } from '../lib/data/google-probe-server-context.ts';
import { probeLiveGoogleConnection } from '../lib/application/google-probe-service.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

type GoogleCommand = 'status' | 'scopes' | 'oauth-start' | 'oauth-complete' | 'probe' | 'sync-gmail' | 'create-calendar' | 'sync-calendar' | 'disconnect';

interface Options {
  readonly command: GoogleCommand;
  readonly live: boolean;
  readonly connectionId?: string;
  readonly bundle?: string;
  readonly state?: string;
  readonly code?: string;
}

export interface GoogleCliDependencies extends CliOutput {
  readonly liveStatus?: (connectionId: string) => Promise<unknown>;
  readonly liveOAuthStart?: (input: { bundle: string; connectionId?: string }) => Promise<unknown>;
  readonly liveOAuthComplete?: (input: { state: string; code: string }) => Promise<unknown>;
  readonly liveProbe?: (connectionId: string) => Promise<unknown>;
  readonly liveGmailSync?: (connectionId: string) => Promise<unknown>;
  readonly liveCalendarCreate?: (connectionId: string) => Promise<unknown>;
  readonly liveCalendarSync?: (connectionId: string) => Promise<unknown>;
  readonly liveDisconnect?: (connectionId: string) => Promise<unknown>;
}

const COMMANDS: readonly GoogleCommand[] = [
  'status', 'scopes', 'oauth-start', 'oauth-complete', 'probe',
  'sync-gmail', 'create-calendar', 'sync-calendar', 'disconnect',
];

function usage() {
  return [
    'Usage: npm run google -- <command> [options] [--live]',
    'Commands:',
    '  status [--live --connection-id <id>]',
    '  scopes',
    '  oauth-start --live --bundle workspace-core|gmail-send|gmail-metadata|calendar-app-created [--connection-id <id>]',
    '  oauth-complete --live --state <state> --code <one-time-code>',
    '  probe --live --connection-id <id>',
    '  sync-gmail --live --connection-id <id>',
    '  create-calendar --live --connection-id <id>',
    '  sync-calendar --live --connection-id <id>',
    '  disconnect --live --connection-id <id>',
    'Google identity sign-in is separate. Live commands fail closed until connector credentials and authority are configured.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { readonly help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as GoogleCommand)) cliUsageError(usage());
  const result: Record<string, unknown> = { command: argv[0], live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') result.live = true;
    else if (argument === '--connection-id') result.connectionId = optionValue(argv, index++, argument);
    else if (argument === '--bundle') result.bundle = optionValue(argv, index++, argument);
    else if (argument === '--state') result.state = optionValue(argv, index++, argument);
    else if (argument === '--code') result.code = optionValue(argv, index++, argument);
    else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return result as unknown as Options;
}

function required(value: string | undefined, field: string): string {
  if (!value?.trim() || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConnectorError('invalid-input', `${field} is required.`);
  }
  return value.trim();
}

function executeSample(selected: Options) {
  const definition = loadConnectorRuntimeConfiguration().definitions.find((item) => item.provider === 'google');
  if (selected.command === 'status') return {
    provider: 'google', enabled: definition?.enabled === true,
    mode: definition?.mode ?? 'provider-disabled', identitySignInIsConnectorAccess: false,
    productionRequirements: definition?.productionRequirements ?? [],
  };
  if (selected.command === 'scopes') return {
    identitySignIn: ['openid', 'email', 'profile'],
    featureBundles: GOOGLE_FEATURE_BUNDLES.map((bundle) => ({ bundle, scopes: GOOGLE_BUNDLE_SCOPES[bundle] })),
    explicitlyExcluded: ['gmail.readonly', 'gmail.modify', 'calendar.events', 'primary-calendar-write'],
  };
  throw new ConnectorError('provider-disabled', 'Google live connector authority is required for this command.');
}

function oauthSessionSecret(): string {
  const value = process.env.OMNIX_GOOGLE_OAUTH_SESSION_SECRET?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(value)) {
    throw new ConnectorError('configuration-required',
      'Set OMNIX_GOOGLE_OAUTH_SESSION_SECRET to a private 43–256 character URL-safe value.');
  }
  return value;
}

async function defaultLiveStatus(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  loadGoogleConfiguredRuntimeConfiguration();
  return supabaseGoogleOperationRepository({ authenticated: client }).readCapabilityState(scope, connectionId);
}

async function defaultLiveOAuthStart(input: { bundle: string; connectionId?: string }) {
  const { client, scope } = await createAuthenticatedCliContext();
  return beginGoogleOAuth({
    repository: createGoogleOAuthServerRepository({ authenticated: client }), scope,
    actorUserId: scope.authenticatedUserId, sessionSecret: oauthSessionSecret(),
    safeReturnPath: '/connections', bundle: parseGoogleFeatureBundle(input.bundle),
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    configuration: loadGoogleOAuthConfiguration(),
  });
}

async function defaultLiveOAuthComplete(input: { state: string; code: string }) {
  const { client, scope } = await createAuthenticatedCliContext();
  return completeGoogleOAuth({
    repository: createGoogleOAuthServerRepository({ authenticated: client }), scope,
    actorUserId: scope.authenticatedUserId, sessionSecret: oauthSessionSecret(),
    state: input.state, code: input.code, configuration: loadGoogleOAuthConfiguration(),
  });
}

async function defaultLiveDisconnect(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  const configuration = loadGoogleConfiguredRuntimeConfiguration();
  return disconnectConnectorCommand(supabaseConnectorRepository(client, configuration.definitions), scope, {
    connectionId, correlationId: randomUUID(),
  });
}

async function defaultLiveProbe(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  loadGoogleConfiguredRuntimeConfiguration();
  return probeLiveGoogleConnection({
    repository: createGoogleProbeServerRepository({ authenticated: client }), scope,
    connectionId, correlationId: randomUUID(), oauthConfiguration: loadGoogleOAuthConfiguration(),
  });
}

async function defaultLiveCalendarCreate(connectionId: string) {
  const { client, scope } = await createAuthenticatedCliContext();
  const configuration = loadGoogleConfiguredRuntimeConfiguration();
  return prepareGoogleCalendarCreationIntent(
    supabaseConnectorRepository(client, configuration.definitions),
    createGoogleOperationServerRepository({ authenticated: client }),
    configuration,
    scope,
    { connectionId, correlationId: randomUUID() },
  );
}

async function defaultLiveSync(connectionId: string, actionType: 'gmail.sync-metadata' | 'calendar.sync') {
  const { client, scope } = await createAuthenticatedCliContext();
  const configuration = loadGoogleConfiguredRuntimeConfiguration();
  return prepareGoogleSyncIntent(
    supabaseConnectorRepository(client, configuration.definitions),
    createGoogleOperationServerRepository({ authenticated: client }),
    configuration,
    scope,
    { connectionId, actionType, correlationId: randomUUID() },
  );
}

async function executeLive(selected: Options, dependencies: GoogleCliDependencies) {
  const connectionId = () => required(selected.connectionId, '--connection-id');
  if (selected.command === 'status') return (dependencies.liveStatus ?? defaultLiveStatus)(connectionId());
  if (selected.command === 'oauth-start') {
    const bundle = parseGoogleFeatureBundle(selected.bundle);
    return (dependencies.liveOAuthStart ?? defaultLiveOAuthStart)({
      bundle, ...(selected.connectionId ? { connectionId: selected.connectionId } : {}),
    });
  }
  if (selected.command === 'oauth-complete') return (dependencies.liveOAuthComplete ?? defaultLiveOAuthComplete)({
    state: required(selected.state, '--state'), code: required(selected.code, '--code'),
  });
  if (selected.command === 'probe') return (dependencies.liveProbe ?? defaultLiveProbe)(connectionId());
  if (selected.command === 'sync-gmail') return (dependencies.liveGmailSync
    ?? ((id) => defaultLiveSync(id, 'gmail.sync-metadata')))(connectionId());
  if (selected.command === 'create-calendar') return (dependencies.liveCalendarCreate
    ?? defaultLiveCalendarCreate)(connectionId());
  if (selected.command === 'sync-calendar') return (dependencies.liveCalendarSync
    ?? ((id) => defaultLiveSync(id, 'calendar.sync')))(connectionId());
  if (selected.command === 'disconnect') return (dependencies.liveDisconnect ?? defaultLiveDisconnect)(connectionId());
  throw new ConnectorError('invalid-input', 'Google command is invalid.');
}

export async function runGoogleCli(argv: readonly string[], output: GoogleCliDependencies = {}): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (output.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    const result = selected.live ? await executeLive(selected, output) : executeSample(selected);
    return writeCliEnvelope(output, { ok: true, resource: 'connectors', command: `google.${selected.command}`, live, result });
  } catch (error) {
    return writeCliEnvelope(output, { ok: false, resource: 'connectors', command: 'google', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runGoogleCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
