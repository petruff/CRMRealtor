#!/usr/bin/env node

import { planExactContactMerge, type ContactMergeEvidenceKind } from '../lib/application/contact-merge-plan.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): string {
  return [
    'Usage: npm run contacts:dedupe:plan -- --live --kind <external-id|email|phone> --group-hash <sha256>',
    '',
    'Creates a redacted, non-mutating merge plan. Contact apply remains unavailable until Story 3.15 activation gates pass.',
    'Raw identifiers and PII are never accepted by this command.',
  ].join('\n');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }
  if (process.argv.includes('--apply')) {
    throw new Error('Apply refused: migration 0028 and the production backup/UAT gates are not approved.');
  }
  if (!process.argv.includes('--live')) throw new Error(`Live owner context is required.\n${usage()}`);
  const kind = option('--kind');
  const groupHash = option('--group-hash');
  if (!['external-id', 'email', 'phone'].includes(kind ?? '') || !groupHash) throw new Error(usage());
  const context = await createAuthenticatedCliContext();
  const occurredAt = new Date();
  const receipt = await planExactContactMerge({
    client: context.client,
    scope: context.scope,
    evidenceKind: kind as ContactMergeEvidenceKind,
    groupHash,
    idempotencyKey: `merge-plan:${kind}:${groupHash.slice(0, 48)}`,
    occurredAt: occurredAt.toISOString(),
    expiresAt: new Date(occurredAt.getTime() + 60 * 60 * 1000).toISOString(),
  });
  console.log(JSON.stringify({ ok: true, mode: 'plan-only', workspaceId: context.scope.workspaceId, receipt }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
