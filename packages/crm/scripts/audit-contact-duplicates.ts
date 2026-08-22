#!/usr/bin/env node

import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseRichContactRepository } from '../lib/data/supabase-rich-contact-repository.ts';
import {
  buildContactDuplicateAudit,
  loadContactDuplicateAudit,
} from '../lib/application/contact-duplicate-audit.ts';
import type { Contact } from '../lib/domain/contact.ts';
import type { ContactPoint } from '../lib/domain/rich-contact.ts';

function usage(): string {
  return [
    'Usage: npm run contacts:dedupe:audit -- [--live]',
    '',
    'Default mode is a process-only sample. Live mode uses the authenticated CLI workspace.',
    'Output contains hashes and contact UUIDs only; raw email and phone values are never printed.',
  ].join('\n');
}

function sampleAudit() {
  const common: Omit<Contact, 'id' | 'firstName'> = {
    lastName: 'Sample', leadType: 'warm', relationship: 'lead', intent: 'unknown', source: 'other',
    pipelineStage: 'new', tags: [], emailSubscribed: true, createdAt: '2026-08-14T00:00:00.000Z',
  };
  const contacts: Contact[] = [
    { ...common, id: 'contact-sample-a', firstName: 'A' },
    { ...common, id: 'contact-sample-b', firstName: 'B' },
  ];
  const points: ContactPoint[] = contacts.map((contact, index) => ({
    id: `point-sample-${index}`, workspaceId: 'workspace-sample', contactId: contact.id,
    type: 'email', label: 'Sample', displayValue: 'hidden@example.com', normalizedValue: 'hidden@example.com',
    isPrimary: true, displayOrder: 0, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
  }));
  return buildContactDuplicateAudit({ contacts, points, asOf: '2026-08-14T12:00:00.000Z' });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  const unknown = argv.filter((argument) => argument !== '--live');
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}\n${usage()}`);
  const live = argv.includes('--live');
  if (!live) {
    console.log(JSON.stringify({ ok: true, mode: 'demo-process-only', audit: sampleAudit() }, null, 2));
    return;
  }

  const { client, scope } = await createAuthenticatedCliContext();
  const { audit } = await loadContactDuplicateAudit({
    repository: supabaseRepository(client, scope),
    richContactRepository: supabaseRichContactRepository(client),
    workspaceScope: scope,
  });
  console.log(JSON.stringify({ ok: true, mode: 'live', workspaceId: scope.workspaceId, audit }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
