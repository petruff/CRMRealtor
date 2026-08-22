#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseContactImport, type ImportSource } from '../lib/application/contact-import.ts';

interface Options {
  file?: string;
  source: ImportSource;
  commit: boolean;
  endpoint?: string;
  token?: string;
  idempotencyKey?: string;
}

function usage() {
  return [
    'Usage: npm run contacts:import -- <file.csv|file.vcf> [options]',
    '',
    '  --source <auto|spreadsheet|mailchimp|google|apple|boldtrail>',
    '  --commit                    Send to the configured live intake endpoint',
    '  --endpoint <url>            Or set OMNIX_INTAKE_URL',
    '  --token <token>             Or set OMNIX_INTAKE_TOKEN',
    '  --idempotency-key <key>     Optional; defaults to a content hash',
    '',
    'Without --commit this command is a read-only JSON preview.',
  ].join('\n');
}

function options(argv: string[]): Options {
  const result: Options = { source: 'auto', commit: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (!argument.startsWith('--') && !result.file) result.file = argument;
    else if (argument === '--commit') result.commit = true;
    else if (argument === '--source') result.source = argv[++index] as ImportSource;
    else if (argument === '--endpoint') result.endpoint = argv[++index];
    else if (argument === '--token') result.token = argv[++index];
    else if (argument === '--idempotency-key') result.idempotencyKey = argv[++index];
    else if (argument === '--help' || argument === '-h') { console.log(usage()); process.exit(0); }
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!['auto', 'spreadsheet', 'mailchimp', 'google', 'apple', 'boldtrail'].includes(result.source)) {
    throw new Error(`Unsupported source: ${result.source}`);
  }
  return result;
}

async function main() {
  const selected = options(process.argv.slice(2));
  if (!selected.file) throw new Error(usage());
  const content = await readFile(selected.file, 'utf8');
  const parsed = parseContactImport({ content, filename: basename(selected.file), source: selected.source });
  const preview = {
    ok: true,
    mode: 'preview',
    provider: parsed.provider,
    format: parsed.format,
    totalRows: parsed.totalRows,
    accepted: parsed.candidates.length,
    rejected: parsed.rejected,
    recognizedFields: parsed.recognizedFields,
    unknownFields: parsed.unknownFields,
  };
  if (!selected.commit) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  if (parsed.rejected.length > 0) {
    throw new Error(`Live commit refused: fix the ${parsed.rejected.length} rejected row(s) shown in preview first.`);
  }

  const endpoint = selected.endpoint ?? process.env.OMNIX_INTAKE_URL ?? process.env.CRM_INTAKE_URL;
  const token = selected.token ?? process.env.OMNIX_INTAKE_TOKEN ?? process.env.CRM_INTAKE_TOKEN;
  if (!endpoint || !token) {
    throw new Error('Live commit refused: provide OMNIX_INTAKE_URL and OMNIX_INTAKE_TOKEN (or --endpoint and --token).');
  }
  const contacts = parsed.candidates.map((candidate) => ({
    ...candidate,
    externalId: candidate.externalId ?? `file-${createHash('sha256')
      .update([parsed.provider, parsed.filename, candidate.rowNumber, candidate.email, candidate.phone, candidate.firstName, candidate.lastName].join('|'))
      .digest('hex')}`,
  }));
  const payload = JSON.stringify({ source: parsed.provider, contacts });
  const idempotencyKey = selected.idempotencyKey
    ?? `cli:${createHash('sha256').update(payload).digest('hex').slice(0, 48)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: payload,
  });
  const responseBody = await response.json().catch(() => ({ ok: false, message: 'Intake returned a non-JSON response.' }));
  console.log(JSON.stringify({ httpStatus: response.status, idempotencyKey, ...responseBody }, null, 2));
  const partial = response.status === 207
    || Boolean(responseBody && typeof responseBody === 'object' && 'ok' in responseBody && responseBody.ok === false);
  if (!response.ok || partial) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
