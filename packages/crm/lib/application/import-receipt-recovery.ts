import type {
  ContactImportPreview,
  ContactImportResult,
} from './contact-import-service.ts';

type ReceiptOutcome = ContactImportResult['rowOutcomes'][number];

export type ImportReceiptPreflight =
  | { readonly state: 'ready' }
  | {
      readonly state: 'recorded' | 'recovered';
      readonly runId: string;
      readonly counts: {
        readonly total: number;
        readonly created: number;
        readonly updated: number;
        readonly unchanged: number;
        readonly rejected: number;
        readonly quarantined: number;
        readonly failed: number;
        readonly notesAdded: number;
      };
      readonly rowOutcomes: readonly ReceiptOutcome[];
    };

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function boundedInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 5_000) {
    throw new Error(`Import receipt ${field} is invalid.`);
  }
  return Number(value);
}

function rowOutcome(value: unknown): ReceiptOutcome {
  const row = object(value, 'Import receipt row is invalid.');
  if (!Number.isSafeInteger(row.rowNumber) || Number(row.rowNumber) < 1
    || !['created', 'updated', 'unchanged', 'rejected', 'quarantined', 'failed'].includes(String(row.outcome))
    || (row.contactId !== undefined && typeof row.contactId !== 'string')
    || (row.errorCode !== undefined && typeof row.errorCode !== 'string')) {
    throw new Error('Import receipt row is invalid.');
  }
  return {
    rowNumber: Number(row.rowNumber),
    outcome: row.outcome as ReceiptOutcome['outcome'],
    ...(typeof row.contactId === 'string' ? { contactId: row.contactId } : {}),
    ...(typeof row.errorCode === 'string' ? { errorCode: row.errorCode } : {}),
  };
}

export function parseImportReceiptPreflight(value: unknown): ImportReceiptPreflight {
  const envelope = object(value, 'Import receipt preflight returned an invalid response.');
  if (envelope.state === 'ready') return { state: 'ready' };
  if (!['recorded', 'recovered'].includes(String(envelope.state))
    || typeof envelope.runId !== 'string') {
    throw new Error('Import receipt preflight returned an invalid response.');
  }
  const counts = object(envelope.counts, 'Import receipt counts are invalid.');
  if (!Array.isArray(envelope.rowOutcomes)) throw new Error('Import receipt rows are invalid.');
  const parsedCounts = {
    total: boundedInteger(counts.total, 'total'),
    created: boundedInteger(counts.created, 'created count'),
    updated: boundedInteger(counts.updated, 'updated count'),
    unchanged: boundedInteger(counts.unchanged, 'unchanged count'),
    rejected: boundedInteger(counts.rejected, 'rejected count'),
    quarantined: boundedInteger(counts.quarantined, 'quarantined count'),
    failed: boundedInteger(counts.failed, 'failed count'),
    notesAdded: boundedInteger(counts.notesAdded, 'notes count'),
  };
  const rowOutcomes = envelope.rowOutcomes.map(rowOutcome);
  if (rowOutcomes.length !== parsedCounts.total
    || parsedCounts.created + parsedCounts.updated + parsedCounts.unchanged
      + parsedCounts.rejected + parsedCounts.quarantined + parsedCounts.failed !== parsedCounts.total) {
    throw new Error('Import receipt totals do not match its rows.');
  }
  return {
    state: envelope.state as 'recorded' | 'recovered',
    runId: envelope.runId,
    counts: parsedCounts,
    rowOutcomes,
  };
}

export function importResultFromReceipt(
  preview: ContactImportPreview,
  receipt: Exclude<ImportReceiptPreflight, { state: 'ready' }>,
): ContactImportResult {
  return {
    ok: receipt.counts.rejected === 0 && receipt.counts.failed === 0,
    provider: preview.provider,
    totalRows: receipt.counts.total,
    created: receipt.counts.created,
    updated: receipt.counts.updated,
    unchanged: receipt.counts.unchanged,
    merged: 0,
    archivedMatches: 0,
    ambiguousIdentities: 0,
    notesAdded: receipt.counts.notesAdded,
    rejected: receipt.counts.rejected,
    quarantined: receipt.counts.quarantined,
    protected: 0,
    failed: receipt.counts.failed,
    errors: [],
    rowOutcomes: [...receipt.rowOutcomes],
    receiptState: receipt.state,
  };
}
