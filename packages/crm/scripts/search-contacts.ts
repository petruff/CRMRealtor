#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { parseContactScope, parseLeadType, queryContacts } from '../lib/application/contact-query.ts';
import type { ContactRepository } from '../lib/data/repository.ts';
import { resolveServerWorkspaceScope } from '../lib/data/automation-context.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { displayName, type Contact } from '../lib/domain/contact.ts';

interface Options {
  query?: string;
  leadType?: string;
  scope?: string;
  live: boolean;
}

function usage(): string {
  return [
    'Usage: npm run contacts:search -- [--query <text>] [--lead-type <hot|warm|nurture>] [--scope <leads|clients|active-clients|past-clients|needs-review|all>] [--live]',
    '',
    'Without --live, the command searches explicit process-only sample data.',
  ].join('\n');
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
  return value;
}

function options(argv: string[]): Options {
  const selected: Options = { live: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--query') {
      selected.query = optionValue(argv, index, '--query');
      index += 1;
    } else if (argument === '--lead-type') {
      selected.leadType = optionValue(argv, index, '--lead-type');
      index += 1;
    } else if (argument === '--scope') {
      selected.scope = optionValue(argv, index, '--scope');
      index += 1;
    }
    else if (argument === '--live') selected.live = true;
    else if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown option: ${argument}\n${usage()}`);
  }
  return selected;
}

function demoRepository(): ContactRepository {
  const common: Omit<Contact, 'id' | 'firstName' | 'lastName' | 'leadType'> = {
    relationship: 'lead', intent: 'unknown', source: 'other', pipelineStage: 'new',
    tags: [], createdAt: '2026-08-11T00:00:00.000Z', emailSubscribed: true,
  };
  const contacts: Contact[] = [
    { ...common, id: 'c-monroe', firstName: 'Celia', lastName: 'Monroe', preferredName: 'Cece', leadType: 'hot', phone: '(404) 555-0101', email: 'celia@example.com', city: 'Decatur', state: 'GA', postalCode: '30030', tags: ['Open House'] },
    { ...common, id: 'c-okafor', firstName: 'Nia', lastName: 'Okafor', leadType: 'hot', phone: '(404) 555-0102', city: 'Atlanta', state: 'GA', postalCode: '30308', tags: ['Buyer'] },
    { ...common, id: 'c-reyes', firstName: 'Mateo', lastName: 'Reyes', leadType: 'warm', relationship: 'active-client', email: 'mateo@example.com', city: 'Decatur', state: 'GA', postalCode: '30033', tags: ['Buyer'] },
    { ...common, id: 'c-pryor', firstName: 'June', lastName: 'Pryor', leadType: 'nurture', relationship: 'past-client', qualificationStatus: 'needs-qualification', city: 'Atlanta', state: 'GA', postalCode: '30305', tags: ['Past Client'] },
  ];
  return {
    async list() { return contacts; },
    async get(id) { return contacts.find((contact) => contact.id === id); },
    async create() { throw new Error('Not available in the contact search CLI.'); },
    async update() { throw new Error('Not available in the contact search CLI.'); },
    async remove() {},
    async notesFor() { return []; },
    async addNote() { throw new Error('Not available in the contact search CLI.'); },
  };
}

async function repository(selected: Options): Promise<ContactRepository> {
  if (!selected.live) return demoRepository();
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
  return supabaseRepository(client, scope);
}

async function main() {
  const selected = options(process.argv.slice(2));
  const leadType = parseLeadType(selected.leadType);
  const scope = parseContactScope(selected.scope);
  const contacts = queryContacts(await (await repository(selected)).list(), {
    query: selected.query,
    leadType,
    scope,
  });
  console.log(JSON.stringify({
    ok: true,
    mode: selected.live ? 'live' : 'demo-process-only',
    query: selected.query?.trim() ?? '',
    leadType: leadType ?? null,
    scope,
    count: contacts.length,
    results: contacts.map((contact) => ({
      id: contact.id,
      name: displayName(contact),
      leadType: contact.leadType,
      relationship: contact.relationship,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      city: contact.city ?? null,
      state: contact.state ?? null,
      postalCode: contact.postalCode ?? null,
      tags: contact.tags,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
