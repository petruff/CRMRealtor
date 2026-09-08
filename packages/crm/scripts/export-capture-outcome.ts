import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseCaptureOutcomeRepository } from '../lib/data/supabase-capture-outcome-repository.ts';
import { captureExportReceiptWriter } from '../lib/data/capture-export-receipt.ts';
import { exportCaptureOutcome } from '../lib/application/capture-outcome-export.ts';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Usage: npm run omnix:capture:export -- --live <contactId> <proposalId> [--include-source]\nExports one current review as JSON to stdout after recording its receipt. Default excludes source-derived text.\n');
} else {
  try {
    if (args[0] !== '--live' || !args[1] || !args[2] || args.length > 4 || (args[3] && args[3] !== '--include-source')) throw new Error('invalid');
    const { client, scope } = await createAuthenticatedCliContext();
    const result = await exportCaptureOutcome({ scope, contacts: supabaseRepository(client, scope),
      captures: supabaseCaptureOutcomeRepository(client), recordReceipt: captureExportReceiptWriter(client, scope),
    }, { contactId: args[1], proposalId: args[2], includeSource: args[3] === '--include-source' });
    process.stdout.write(`${result.body}\n`);
  } catch {
    process.stderr.write('Review export failed. Check the authenticated workspace, contact, review and export storage.\n');
    process.exitCode = 1;
  }
}
