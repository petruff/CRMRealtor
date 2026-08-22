#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  loadConnectorRuntimeConfiguration,
  loadTwilioConfiguredRuntimeConfiguration,
} from '../lib/config/connector-runtime.ts';
import { ConnectorError } from '../lib/domain/connector.ts';
import { evaluateTextingQuietHours } from '../lib/domain/texting.ts';
import { loadTwilioConfiguration, TwilioMessagingClient } from '../lib/providers/twilio-client.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { createClient } from '@supabase/supabase-js';
import { supabaseTwilioOperationRepository } from '../lib/data/twilio-operation-repository.ts';
import { supabaseContactOutboundGuard } from '../lib/data/supabase-contact-outbound-guard.ts';
import {
  approveTextingIntentCommand,
  disableTextingCommand,
  prepareTextingMessageCommand,
  readContactTextingSummaryCommand,
  readTextingReadinessCommand,
  recordTextingConsentCommand,
} from '../lib/application/texting-commands.ts';
import { configureTwilioConnection } from '../lib/application/twilio-setup-service.ts';
import {
  CRM_WORK_QUEUE_CLI_EXIT,
  cliUsageError,
  optionValue,
  writeCliEnvelope,
  type CliOutput,
} from './crm-work-queue-cli.ts';

type Command = 'status' | 'readiness' | 'quiet-hours' | 'probe' | 'configure' | 'consent' | 'prepare' | 'approve' | 'uat' | 'conversation' | 'reconcile' | 'disable';

interface Options {
  readonly command: Command;
  readonly live: boolean;
  readonly timeZone?: string;
  readonly start?: string;
  readonly end?: string;
  readonly at?: string;
  readonly connectionId?: string; readonly contactId?: string; readonly contactPointId?: string;
  readonly phone?: string; readonly useCase?: string; readonly body?: string; readonly status?: string;
  readonly method?: string; readonly disclosure?: string; readonly evidence?: string;
  readonly intentId?: string; readonly intentVersion?: string; readonly payloadHash?: string;
  readonly destroyCredentials?: boolean;
}

export interface TextingCliDependencies extends CliOutput {
  readonly liveProbe?: () => Promise<unknown>;
  readonly liveOperation?: (command: Command, options: Options) => Promise<unknown>;
}

const COMMANDS: readonly Command[] = ['status', 'readiness', 'quiet-hours', 'probe', 'configure', 'consent', 'prepare', 'approve', 'uat', 'conversation', 'reconcile', 'disable'];

function usage() {
  return [
    'Usage: npm run texting -- <command> [options] [--live]',
    'Commands:',
    '  status',
    '  readiness [--live]',
    '  quiet-hours --time-zone <IANA> --start <HH:mm> --end <HH:mm> [--at <ISO>]',
    '  probe --live  (server-bound Twilio account/Messaging Service check)',
    '  configure --live [--connection-id <uuid>]  (owner-only server credential and callback binding)',
    '  consent --live --connection-id <uuid> --contact-id <uuid> --contact-point-id <uuid> --use-case <type> --status <opted_in|opted_out|unknown> --method <method> --disclosure <version> --evidence <reference> [--time-zone <IANA>]',
    '  prepare --live --connection-id <uuid> --contact-id <uuid> --contact-point-id <uuid> --phone <E.164> --use-case <type> --body <text>',
    '  approve --live --intent-id <uuid> --intent-version <n> --payload-hash <sha256>',
    '  uat --live --connection-id <uuid> --contact-id <uuid> --contact-point-id <uuid> --phone <E.164> --body <text> [--time-zone <IANA>]',
    '  conversation --live --connection-id <uuid> --contact-id <uuid> --contact-point-id <uuid>',
    '  reconcile --live  (service-role worker; no provider send)',
    '  disable --live --connection-id <uuid> [--destroy-credentials]',
    'Texting remains provider-disabled until registration, policy, signed-callback and real-number UAT approvals pass.',
  ].join('\n');
}

function parse(argv: readonly string[]): Options | { readonly help: true } {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true };
  if (!COMMANDS.includes(argv[0] as Command)) cliUsageError(usage());
  const value: Record<string, unknown> = { command: argv[0], live: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') value.live = true;
    else if (argument === '--time-zone') value.timeZone = optionValue(argv, index++, argument);
    else if (argument === '--start') value.start = optionValue(argv, index++, argument);
    else if (argument === '--end') value.end = optionValue(argv, index++, argument);
    else if (argument === '--at') value.at = optionValue(argv, index++, argument);
    else if (argument === '--connection-id') value.connectionId = optionValue(argv, index++, argument);
    else if (argument === '--contact-id') value.contactId = optionValue(argv, index++, argument);
    else if (argument === '--contact-point-id') value.contactPointId = optionValue(argv, index++, argument);
    else if (argument === '--phone') value.phone = optionValue(argv, index++, argument);
    else if (argument === '--use-case') value.useCase = optionValue(argv, index++, argument);
    else if (argument === '--body') value.body = optionValue(argv, index++, argument);
    else if (argument === '--status') value.status = optionValue(argv, index++, argument);
    else if (argument === '--method') value.method = optionValue(argv, index++, argument);
    else if (argument === '--disclosure') value.disclosure = optionValue(argv, index++, argument);
    else if (argument === '--evidence') value.evidence = optionValue(argv, index++, argument);
    else if (argument === '--intent-id') value.intentId = optionValue(argv, index++, argument);
    else if (argument === '--intent-version') value.intentVersion = optionValue(argv, index++, argument);
    else if (argument === '--payload-hash') value.payloadHash = optionValue(argv, index++, argument);
    else if (argument === '--destroy-credentials') value.destroyCredentials = true;
    else cliUsageError(`Unknown option: ${argument}\n${usage()}`);
  }
  return value as unknown as Options;
}

async function defaultLiveOperation(command: Command, selected: Options) {
  if (command === 'reconcile') {
    const { drainConfiguredConnectorServiceJobs } = await import('../lib/application/connector-service-worker.ts');
    return drainConfiguredConnectorServiceJobs(process.env, { reconciliationOnly: true });
  }
  const { client, scope } = await createAuthenticatedCliContext();
  if (command === 'configure') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new ConnectorError('configuration-required', 'Twilio CLI service authority is missing.');
    return configureTwilioConnection({ authenticated: client,
      service: createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }),
      scope, connectionId: selected.connectionId });
  }
  const repository = supabaseTwilioOperationRepository(client);
  const connectionId = () => required(selected.connectionId, '--connection-id');
  const contact = () => ({
    connectionId: connectionId(), contactId: required(selected.contactId, '--contact-id'),
    contactPointId: required(selected.contactPointId, '--contact-point-id'),
  });
  if (command === 'readiness') return readTextingReadinessCommand(repository, scope, connectionId());
  if (command === 'conversation') return readContactTextingSummaryCommand(repository, scope, contact());
  if (command === 'consent') return recordTextingConsentCommand(repository, scope, {
    ...contact(), useCase: required(selected.useCase, '--use-case'), status: required(selected.status, '--status'),
    collectionMethod: required(selected.method, '--method'), disclosureVersion: required(selected.disclosure, '--disclosure'),
    evidenceReference: required(selected.evidence, '--evidence'), recipientTimeZone: selected.timeZone,
    timezoneSource: selected.timeZone ? 'verified-cli-evidence' : undefined,
  });
  if (command === 'prepare') return prepareTextingMessageCommand(repository, scope, {
    ...contact(), recipientPhone: required(selected.phone, '--phone'), useCase: required(selected.useCase, '--use-case'),
    body: required(selected.body, '--body', 1_600),
  }, supabaseContactOutboundGuard(client));
  if (command === 'approve') return approveTextingIntentCommand(repository, scope, {
    intentId: required(selected.intentId, '--intent-id'), intentVersion: required(selected.intentVersion, '--intent-version'),
    payloadHash: required(selected.payloadHash, '--payload-hash'),
  });
  if (command === 'uat') return repository.requestRealNumberUat(scope, {
    ...contact(), recipientPhone: required(selected.phone, '--phone'), body: required(selected.body, '--body', 1_600),
    recipientTimeZone: selected.timeZone, timezoneSource: selected.timeZone ? 'verified-cli-evidence' : undefined,
    occurredAt: new Date().toISOString(),
  });
  if (command === 'disable') return disableTextingCommand(repository, scope, {
    connectionId: connectionId(), destroySendCredentials: selected.destroyCredentials === true,
  });
  throw new ConnectorError('invalid-input', 'Texting live command is invalid.');
}

function required(value: string | undefined, field: string, maxLength = 160): string {
  if (!value?.trim() || value.length > maxLength || /[\u0000\u007f]/.test(value)) {
    throw new ConnectorError('invalid-input', `${field} is required.`);
  }
  return value.trim();
}

function approvalState(environment: Record<string, string | undefined>) {
  const requirements = {
    registration: environment.OMNIX_CONNECTOR_TWILIO_REGISTRATION_APPROVED === 'approved',
    consentAndQuietHoursPolicy: environment.OMNIX_CONNECTOR_TWILIO_POLICY_APPROVED === 'approved',
    signedCallbackUat: false,
    realNumberUat: false,
  };
  return { requirements, readyForProduction: false,
    authority: 'Persisted callback and real-number UAT receipts are required; environment declarations are not approvals.' };
}

async function execute(selected: Options, dependencies: TextingCliDependencies) {
  if (selected.command === 'status') {
    const definition = loadConnectorRuntimeConfiguration().definitions.find((item) => item.provider === 'twilio');
    return { provider: 'twilio', enabled: false, mode: definition?.mode, deviceSmsFallbackIsProviderSend: false };
  }
  if (selected.command === 'quiet-hours') {
    return evaluateTextingQuietHours({
      recipientTimeZone: required(selected.timeZone, '--time-zone'),
      startLocal: required(selected.start, '--start'), endLocal: required(selected.end, '--end'),
      policyVersion: 'cli-preview.v1',
    }, selected.at ? new Date(selected.at) : new Date());
  }
  if (selected.command === 'readiness') {
    if (!selected.live) return { ...approvalState({}), configured: false, mode: 'provider-disabled' };
    if (dependencies.liveOperation) return dependencies.liveOperation(selected.command, selected);
    const configuration = loadTwilioConfiguredRuntimeConfiguration();
    return {
      ...approvalState(process.env), configured: true,
      mode: configuration.definitions.find((item) => item.provider === 'twilio')?.mode,
      credentialsRedacted: true,
    };
  }
  if (selected.command === 'probe') {
    if (!selected.live) throw new ConnectorError('provider-disabled', 'Twilio probe requires live server authority.');
    // A read-only provider probe is part of controlled UAT evidence. It must be
    // possible before production activation, while still requiring the complete
    // server-side credential/configuration boundary.
    loadTwilioConfiguredRuntimeConfiguration();
    if (dependencies.liveProbe) return dependencies.liveProbe();
    return new TwilioMessagingClient(loadTwilioConfiguration()).probeMessagingService();
  }
  if (['configure', 'consent', 'prepare', 'approve', 'uat', 'conversation', 'reconcile', 'disable'].includes(selected.command)) {
    if (!selected.live) throw new ConnectorError('provider-disabled', `${selected.command} requires live workspace authority.`);
    return (dependencies.liveOperation ?? defaultLiveOperation)(selected.command, selected);
  }
  throw new ConnectorError('invalid-input', 'Texting command is invalid.');
}

export async function runTextingCli(
  argv: readonly string[],
  dependencies: TextingCliDependencies = {},
): Promise<number> {
  let live = argv.includes('--live');
  try {
    const selected = parse(argv);
    if ('help' in selected) {
      (dependencies.stdout ?? ((value) => process.stdout.write(value)))(`${usage()}\n`);
      return CRM_WORK_QUEUE_CLI_EXIT.success;
    }
    live = selected.live;
    const result = await execute(selected, dependencies);
    return writeCliEnvelope(dependencies, {
      ok: true, resource: 'connectors', command: `texting.${selected.command}`, live, result,
    });
  } catch (error) {
    return writeCliEnvelope(dependencies, { ok: false, resource: 'connectors', command: 'texting', live, error });
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runTextingCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
