import { extractCaptureOutcome, type CaptureExtractionResult } from './capture-outcome-extraction.ts';
import type { CaptureRunTelemetry } from '../domain/capture-run-telemetry.ts';

/** Failed observability discards optional AI content; the canonical budget still accounts for the call. */
export async function extractAndRecordCaptureOutcome(source: string, options: Parameters<typeof extractCaptureOutcome>[1], record: (data: CaptureRunTelemetry) => Promise<void>): Promise<CaptureExtractionResult> {
  const result = await extractCaptureOutcome(source, options);
  try {
    if (!result.telemetry) throw new Error('missing-metadata');
    await record(result.telemetry);
    return result;
  } catch { return { state: 'failed' }; }
}
