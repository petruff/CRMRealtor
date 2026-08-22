#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  loadMetaConfiguredRuntimeConfiguration,
} from '../lib/config/connector-runtime.ts';
import {
  META_CHANNELS,
  metaPermissionsForChannels,
  type MetaChannel,
} from '../lib/domain/meta.ts';
import { ConnectorError } from '../lib/domain/connector.ts';
import { createClient } from '@supabase/supabase-js';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseMetaOperationRepository } from '../lib/data/meta-operation-repository.ts';
import { discoverAndStageMetaAssets, selectAndSubscribeMetaAssets } from '../lib/application/meta-asset-setup-service.ts';
import { loadMetaOAuthConfiguration } from '../lib/providers/meta-client.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

type Command = 'status' | 'permissions' | 'version' | 'readiness' | 'connection' | 'discover-assets' | 'select-assets' | 'reviews';

interface Options {
  readonly command: Command;
  readonly live: boolean;
  readonly channels: readonly MetaChannel[];
  readonly connectionId?: string;
  readonly snapshotHash?: string;
  readonly assetHashes?: readonly string[];
}

const COMMANDS: readonly Command[] = ['status', 'permissions', 'version', 'readiness', 'connection', 'discover-assets', 'select-assets', 'reviews'];

function usage(): string {
  return [
    'Usage: npm run meta -- <command> [options] [--live]',
    'Commands:',
    '  status',
    '  permissions --channels facebook-page,instagram-business',
    '  version --live',
    '  readiness --live',
    '  connection --live --connection-id <uuid>',
    '  discover-assets --live --connection-id <uuid>',
    '  select-assets --live --connection-id <uuid> --snapshot-hash <sha256> --asset-hashes <sha256,sha256>',
    '  reviews --live --connection-id <uuid>',
    'Inbound business messages only. Lead Ads, personal accounts, and outbound replies are not implemented.',
  ].join('\n');
}

function channels(value: string): readonly MetaChannel[] {
  const parsed = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (!parsed.length || parsed.some((item) => !META_CHANNELS.includes(item as MetaChannel))) {
    throw new ConnectorError('invalid-input', 'Meta channels must be facebook-page and/or instagram-business.');
  }
  return parsed as MetaChannel[];
}

function parse(argv: readonly string[]): Options | { readonly help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as Command)) cliUsageError(usage());
  let selectedChannels: readonly MetaChannel[] = META_CHANNELS;
  let live = false;
  let connectionId: string | undefined;
  let snapshotHash: string | undefined;
  let assetHashes: readonly string[] | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') live = true;
    else if (argument === '--channels') selectedChannels = channels(optionValue(argv, index++, argument));
    else if (argument === '--connection-id') connectionId = optionValue(argv, index++, argument);
    else if (argument === '--snapshot-hash') snapshotHash = optionValue(argv, index++, argument);
    else if (argument === '--asset-hashes') assetHashes = optionValue(argv, index++, argument).split(',').map((item) => item.trim()).filter(Boolean);
    else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return { command: argv[0] as Command, live, channels: selectedChannels, ...(connectionId ? { connectionId } : {}),
    ...(snapshotHash ? { snapshotHash } : {}), ...(assetHashes ? { assetHashes } : {}) };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new ConnectorError('configuration-required', 'Meta CLI service authority is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

function safeVersionState(environment: Record<string, string | undefined>) {
  return {
    graphVersion: environment.META_GRAPH_API_VERSION?.trim() || 'NOT_AVAILABLE',
    verifiedAt: environment.META_GRAPH_API_VERSION_VERIFIED_AT?.trim() || null,
    sourceUrl: environment.META_GRAPH_API_VERSION_SOURCE_URL?.trim() || null,
    latestIsForbidden: true,
  };
}

function approvalState(environment: Record<string, string | undefined>) {
  const requirements = {
    businessVerification: environment.OMNIX_CONNECTOR_META_BUSINESS_VERIFIED === 'approved',
    appReview: environment.OMNIX_CONNECTOR_META_APP_REVIEW_APPROVED === 'approved',
    retentionPolicy: environment.OMNIX_CONNECTOR_META_RETENTION_POLICY_APPROVED === 'approved',
    realAccountUat: environment.OMNIX_CONNECTOR_META_REAL_ACCOUNT_UAT === 'approved',
  };
  return { requirements, readyForProduction: Object.values(requirements).every(Boolean) };
}

async function execute(selected: Options) {
  if (selected.command === 'status') return {
    provider: 'meta', enabled: false, mode: 'provider-disabled',
    inboundOnly: true, leadAds: false, outboundReplies: false, personalAccounts: false,
    ...safeVersionState(process.env),
  };
  if (selected.command === 'permissions') return {
    channels: selected.channels,
    requestedPermissions: metaPermissionsForChannels(selected.channels),
    leastPrivilege: true,
  };
  if (!selected.live) throw new ConnectorError('provider-disabled', `Meta ${selected.command} requires live server configuration.`);
  const configuration = loadMetaConfiguredRuntimeConfiguration();
  if (selected.command === 'version') return safeVersionState(process.env);
  if (selected.command === 'readiness') return {
    configured: true,
    mode: configuration.definitions.find((item) => item.provider === 'meta')?.mode,
    ...safeVersionState(process.env), ...approvalState(process.env), credentialsRedacted: true,
  };
  if (['connection', 'discover-assets', 'select-assets', 'reviews'].includes(selected.command)) {
    if (!selected.connectionId) throw new ConnectorError('invalid-input', '--connection-id is required.');
    const { client, scope } = await createAuthenticatedCliContext();
    const repository = supabaseMetaOperationRepository(client);
    if (selected.command === 'connection') return repository.readConnectionState(scope, selected.connectionId);
    if (selected.command === 'reviews') return repository.listReviewItems(scope, selected.connectionId, 100);
    if (selected.command === 'discover-assets') return discoverAndStageMetaAssets({
      service: serviceClient(), scope, connectionId: selected.connectionId,
      configuration: loadMetaOAuthConfiguration(),
    });
    if (!selected.snapshotHash || !/^[0-9a-f]{64}$/.test(selected.snapshotHash)
      || !selected.assetHashes?.length || selected.assetHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
      throw new ConnectorError('invalid-input', '--snapshot-hash and --asset-hashes must be current SHA-256 values.');
    }
    return selectAndSubscribeMetaAssets({ authenticated: client, service: serviceClient(), scope,
      connectionId: selected.connectionId, snapshotHash: selected.snapshotHash,
      assetHashes: selected.assetHashes, configuration: loadMetaOAuthConfiguration() });
  }
  throw new ConnectorError('invalid-input', 'Meta command is invalid.');
}

export async function runMetaCli(argv: readonly string[], output: CliOutput = {}): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (output.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    return writeCliEnvelope(output, {
      ok: true, resource: 'connectors', command: `meta.${selected.command}`, live,
      result: await execute(selected),
    });
  } catch (error) {
    return writeCliEnvelope(output, { ok: false, resource: 'connectors', command: 'meta', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runMetaCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
