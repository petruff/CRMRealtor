#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { createMailchimpServerRepository } from '../lib/data/mailchimp-operation-server-context.ts';
import { createMailchimpCampaignDraftCommand, executeMailchimpCampaignActionCommand } from '../lib/application/mailchimp-campaign-service.ts';
import { parseMailchimpCampaignContent, parseMailchimpCampaignSegment } from '../lib/domain/mailchimp-campaign.ts';
import { loadMailchimpConfiguredRuntimeConfiguration } from '../lib/config/connector-runtime.ts';
import { MailchimpMarketingClient } from '../lib/providers/mailchimp-client.ts';
import { ConnectorError } from '../lib/domain/connector.ts';

const usage = [
  'Usage: npm run mailchimp:campaigns -- <list|create|create-in-mailchimp|send> [options]',
  '  list',
  '  create --connection-id <id> --segment <all-subscribers|hot|warm|nurture> --content-json <json>',
  '  create-in-mailchimp --campaign-id <id>',
  '  send --campaign-id <id>',
  'Only the workspace owner can create a provider draft or send a campaign.',
].join('\n');

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) throw new ConnectorError('invalid-input', `${name} is required.`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || ['--help', '-h'].includes(command)) { process.stdout.write(`${usage}\n`); return; }
  const { client, scope } = await createAuthenticatedCliContext();
  const server = createMailchimpServerRepository({ authenticated: client });
  let result: unknown;
  if (command === 'list') result = await server.campaigns.list(scope, 100);
  else if (command === 'create') {
    const rawSegment = option(args, '--segment');
    result = await createMailchimpCampaignDraftCommand({
      repository: server.campaigns, scope, connectionId: option(args, '--connection-id'),
      segment: parseMailchimpCampaignSegment(rawSegment === 'all-subscribers'
        ? { kind: rawSegment } : { kind: 'lead-type', value: rawSegment }),
      content: parseMailchimpCampaignContent(JSON.parse(option(args, '--content-json'))),
      correlationId: randomUUID(),
    });
  } else if (command === 'create-in-mailchimp' || command === 'send') {
    result = await executeMailchimpCampaignActionCommand({
      campaigns: server.campaigns, operations: server.operations,
      configuration: loadMailchimpConfiguredRuntimeConfiguration(), scope,
      campaignId: option(args, '--campaign-id'), action: command === 'send' ? 'send' : 'create',
      correlationId: randomUUID(),
      createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token),
    });
  } else throw new ConnectorError('invalid-input', usage);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 'mailchimp-campaign-cli.v1', command, result }, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Mailchimp campaign command failed safely.';
  process.stderr.write(`${JSON.stringify({ schemaVersion: 'mailchimp-campaign-cli.v1', outcome: 'failed', message })}\n`);
  process.exitCode = 1;
});
