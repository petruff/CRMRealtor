import { describe, expect, it } from 'vitest';
import {
  importResultFromReceipt,
  parseImportReceiptPreflight,
} from './import-receipt-recovery';
import type { ContactImportPreview } from './contact-import-service';

const preview = {
  provider: 'first-class-real-estate',
  filename: 'contacts.numbers',
  format: 'numbers',
} as ContactImportPreview;

describe('import receipt recovery', () => {
  it('parses a ready preflight without inventing evidence', () => {
    expect(parseImportReceiptPreflight({ state: 'ready' })).toEqual({ state: 'ready' });
  });

  it('projects recovered original outcomes into a user-facing import result', () => {
    const receipt = parseImportReceiptPreflight({
      state: 'recovered',
      runId: 'run-a',
      counts: {
        total: 2, created: 1, updated: 1, unchanged: 0,
        rejected: 0, quarantined: 0, failed: 0, notesAdded: 1,
      },
      rowOutcomes: [
        { rowNumber: 1, outcome: 'created', contactId: 'contact-a' },
        { rowNumber: 2, outcome: 'updated', contactId: 'contact-b' },
      ],
    });
    if (receipt.state === 'ready') throw new Error('Expected a recovered receipt.');
    expect(importResultFromReceipt(preview, receipt)).toMatchObject({
      ok: true,
      provider: 'first-class-real-estate',
      totalRows: 2,
      created: 1,
      updated: 1,
      unchanged: 0,
      receiptState: 'recovered',
    });
  });

  it('rejects inconsistent aggregate evidence', () => {
    expect(() => parseImportReceiptPreflight({
      state: 'recorded',
      runId: 'run-a',
      counts: {
        total: 2, created: 2, updated: 0, unchanged: 0,
        rejected: 0, quarantined: 0, failed: 0, notesAdded: 0,
      },
      rowOutcomes: [{ rowNumber: 1, outcome: 'created' }],
    })).toThrow(/totals do not match/i);
  });

  it('reconstructs qualification review separately from quarantined incomplete rows', () => {
    const receipt = parseImportReceiptPreflight({
      state: 'recorded', runId: 'run-review',
      counts: {
        total: 2, created: 1, updated: 0, unchanged: 0,
        rejected: 0, quarantined: 1, failed: 0, notesAdded: 0,
      },
      rowOutcomes: [
        { rowNumber: 1, outcome: 'created', contactId: 'contact-a', errorCode: 'qualification-review' },
        { rowNumber: 2, outcome: 'quarantined', errorCode: 'validation-rejected' },
      ],
    });
    if (receipt.state === 'ready') throw new Error('Expected a terminal receipt.');
    expect(importResultFromReceipt(preview, receipt)).toMatchObject({
      ok: false, qualificationReview: 1, incomplete: 1, rejected: 0, quarantined: 1,
    });
  });
});
