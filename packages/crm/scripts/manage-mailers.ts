#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import {
  createMailerCampaignCommand,
  currentDateOnly,
  listMailerCampaignsCommand,
  markMailerSentCommand,
  unmarkMailerSentCommand,
} from '../lib/application/mailer-commands.ts';
import { createMemoryMailerRepository } from '../lib/data/memory-mailer-repository.ts';
import { resolveServerWorkspaceScope } from '../lib/data/automation-context.ts';
import { supabaseMailerRepository } from '../lib/data/supabase-mailer-repository.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import type { ContactRepository } from '../lib/data/repository.ts';
import type { Contact } from '../lib/domain/contact.ts';

type Command = 'list' | 'create' | 'mark' | 'unmark';

interface Options {
  command?: Command;
  name?: string;
  notes?: string;
  campaign?: string;
  contact?: string;
  live: boolean;
}

const DEMO_CONTACT_IDS = [
  'c-monroe', 'c-okafor', 'c-reyes', 'c-whitfield', 'c-baptiste', 'c-hollings',
  'c-ferraro', 'c-abernathy', 'c-nakamura', 'c-delacroix', 'c-pryor',
];

function usage(): string {
  return [
    'Usage: npm run mailers -- <list|create|mark|unmark> [options]',
    '',
    '  create --name <name> [--notes <notes>]',
    '  mark --campaign <id> --contact <id>',
    '  unmark --campaign <id> --contact <id>',
    '  --live   Require Supabase credentials and a server-side workspace binding',
    '',
    'Without --live, commands use explicit process-only sample data.',
  ].join('\n');
}

function parseOptions(argv: string[]): Options {
  const selected: Options = { live: false };
  const first = argv[0];
  if (first === '--help' || first === '-h') {
    console.log(usage());
    process.exit(0);
  }
  if (first && ['list', 'create', 'mark', 'unmark'].includes(first)) {
    selected.command = first as Command;
  } else {
    throw new Error(usage());
  }
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--name') selected.name = argv[++index];
    else if (argument === '--notes') selected.notes = argv[++index];
    else if (argument === '--campaign') selected.campaign = argv[++index];
    else if (argument === '--contact') selected.contact = argv[++index];
    else throw new Error(`Unknown option: ${argument}`);
  }
  return selected;
}

function demoContacts(): ContactRepository {
  const contact = (id: string): Contact => ({
    id,
    firstName: 'Sample',
    lastName: 'Contact',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'unknown',
    source: 'other',
    pipelineStage: 'new',
    tags: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    emailSubscribed: true,
    mailingAddress: '10 Main St',
    city: 'Decatur',
    state: 'GA',
    postalCode: '30030',
  });
  return {
    async list() { return DEMO_CONTACT_IDS.map(contact); },
    async get(id) { return DEMO_CONTACT_IDS.includes(id) ? contact(id) : undefined; },
    async create() { throw new Error('Not available in the mailer CLI.'); },
    async update() { throw new Error('Not available in the mailer CLI.'); },
    async remove() {},
    async notesFor() { return []; },
    async addNote() { throw new Error('Not available in the mailer CLI.'); },
  };
}

async function repositories(selected: Options) {
  if (!selected.live) {
    const contacts = demoContacts();
    return {
      contacts,
      mailers: createMemoryMailerRepository(contacts, {
        campaigns: [
          { id: 'm-jan', name: 'Just Listed — Alder Hollow', createdAt: '2026-01-01T12:00:00.000Z', sends: [] },
          { id: 'm-dec', name: 'Holiday Card', createdAt: '2026-01-01T12:00:00.000Z', sends: [] },
        ],
      }),
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.OMNIX_INTAKE_WORKSPACE_ID ?? process.env.CRM_INTAKE_WORKSPACE_ID;
  const ownerId = process.env.OMNIX_INTAKE_OWNER_ID ?? process.env.CRM_INTAKE_OWNER_ID;
  if (!url || !serviceRole || (!workspaceId && !ownerId)) {
    throw new Error(
      'Live mode refused: set Supabase credentials and a server-side workspace or owner binding.',
    );
  }
  const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const scope = await resolveServerWorkspaceScope(client, { workspaceId, ownerId });
  return {
    contacts: supabaseRepository(client, scope),
    mailers: supabaseMailerRepository(client, scope),
  };
}

async function main() {
  const selected = parseOptions(process.argv.slice(2));
  const { mailers, contacts } = await repositories(selected);
  let result: unknown;
  if (selected.command === 'list') result = await listMailerCampaignsCommand(mailers);
  else if (selected.command === 'create') {
    result = await createMailerCampaignCommand(mailers, {
      name: selected.name,
      notes: selected.notes,
    });
  } else if (selected.command === 'mark') {
    result = await markMailerSentCommand(
      mailers,
      contacts,
      selected.campaign ?? '',
      selected.contact ?? '',
      currentDateOnly(new Date(), process.env.OMNIX_TIME_ZONE ?? process.env.CRM_TIME_ZONE),
    );
  } else {
    await unmarkMailerSentCommand(
      mailers,
      selected.campaign ?? '',
      selected.contact ?? '',
    );
    result = { campaignId: selected.campaign, contactId: selected.contact, checked: false };
  }
  console.log(JSON.stringify({
    ok: true,
    mode: selected.live ? 'live' : 'demo-process-only',
    command: selected.command,
    result,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
