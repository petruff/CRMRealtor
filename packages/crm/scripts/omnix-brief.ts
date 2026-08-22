#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import type { ContactRepository } from '../lib/data/repository.ts';
import { resolveServerWorkspaceScope } from '../lib/data/automation-context.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import type { Contact } from '../lib/domain/contact.ts';
import { buildWorkspaceSnapshot } from '../lib/domain/workspace-intelligence.ts';

interface Options { live: boolean; today?: string }

function usage(): string {
  return 'Usage: npm run omnix:brief -- [--today <YYYY-MM-DD>] [--live]';
}

function parseOptions(argv: string[]): Options {
  const selected: Options = { live: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--live') selected.live = true;
    else if (argument === '--today') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --today.');
      selected.today = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown option: ${argument}\n${usage()}`);
  }
  return selected;
}

function reportDate(value?: string): Date {
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('--today must use YYYY-MM-DD.');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('--today is not a valid calendar date.');
  }
  return date;
}

function demoRepository(): ContactRepository {
  const base: Omit<Contact, 'id' | 'firstName' | 'lastName'> = {
    leadType: 'warm', relationship: 'lead', intent: 'unknown', source: 'referral',
    pipelineStage: 'new', tags: [], createdAt: '2026-08-01T12:00:00.000Z', emailSubscribed: true,
  };
  const contacts: Contact[] = [
    { ...base, id: 'c-1', firstName: 'Alicia', lastName: 'Monroe', leadType: 'hot', phone: '4045550101', source: 'open-house' },
    { ...base, id: 'c-2', firstName: 'Daniel', lastName: 'Okafor', lastContactedAt: '2026-08-01T12:00:00.000Z', nextTouchAt: '2026-08-10' },
    { ...base, id: 'c-3', firstName: 'Marisol', lastName: 'Reyes', pipelineStage: 'under-contract', lastContactedAt: '2026-08-10T12:00:00.000Z' },
  ];
  return {
    async list() { return contacts; },
    async get(id) { return contacts.find((contact) => contact.id === id); },
    async create() { throw new Error('Not available in the Omnix brief CLI.'); },
    async update() { throw new Error('Not available in the Omnix brief CLI.'); },
    async remove() {},
    async notesFor() { return []; },
    async addNote() { throw new Error('Not available in the Omnix brief CLI.'); },
  };
}

async function repository(selected: Options): Promise<ContactRepository> {
  if (!selected.live) return demoRepository();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const workspaceId = process.env.OMNIX_INTAKE_WORKSPACE_ID ?? process.env.CRM_INTAKE_WORKSPACE_ID;
  const ownerId = process.env.OMNIX_INTAKE_OWNER_ID ?? process.env.CRM_INTAKE_OWNER_ID;
  if (!url || !serviceRole || (!workspaceId && !ownerId)) {
    throw new Error('Live mode refused: set Supabase credentials and a server-side workspace or owner binding.');
  }
  const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const scope = await resolveServerWorkspaceScope(client, { workspaceId, ownerId });
  return supabaseRepository(client, scope);
}

async function main() {
  const selected = parseOptions(process.argv.slice(2));
  const today = reportDate(selected.today);
  const snapshot = buildWorkspaceSnapshot(await (await repository(selected)).list(), today);
  console.log(JSON.stringify({
    ok: true,
    product: 'Omnix',
    poweredBy: 'Cyryx Labs',
    mode: selected.live ? 'live' : 'demo-process-only',
    today: today.toISOString().slice(0, 10),
    snapshot,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
