import { describe, expect, it, vi } from 'vitest';
import { extractCaptureOutcome } from './capture-outcome-extraction';
import { extractAndRecordCaptureOutcome } from './capture-outcome-observed-extraction';
const source = 'Private recap for a client';
const credential = { apiKey: 'secret-test-token', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' as const };
const validResponse = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ schemaVersion: 'capture-outcome.v1', summary: 'Review client recap.', facts: [], tasks: [], unknowns: [] }) }] } }] }));
describe('capture run telemetry', () => {
  it('binds redacted metadata to budget correlation and labels upper-bound accounting', async () => {
    const budget = { reserve: vi.fn().mockResolvedValue({ allowed: true, reservationId: 'reservation-1' }), finalize: vi.fn().mockResolvedValue(undefined) };
    const result = await extractCaptureOutcome(source, { credential, budget, fetchImpl: vi.fn().mockResolvedValue(validResponse()) });
    expect(result.state).toBe('available');
    expect(result.telemetry).toMatchObject({ state: 'available', reason: 'complete', accounting: 'upper-bound-finalized', reservedOutputTokens: 2400, reservationId: 'reservation-1' });
    expect(budget.reserve.mock.calls[0]![0].correlationId).toBe(result.telemetry!.correlationId);
    expect(JSON.stringify(result.telemetry)).not.toContain(source);
    expect(JSON.stringify(result.telemetry)).not.toContain(credential.apiKey);
  });
  it('records unconfigured fallback without calling a provider', async () => {
    const record = vi.fn(); const fetchImpl = vi.fn();
    const result = await extractAndRecordCaptureOutcome(source, { fetchImpl }, record);
    expect(result.state).toBe('unconfigured'); expect(record).toHaveBeenCalledOnce(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('discards model content after metadata failure without retrying or evading accounting', async () => {
    const budget = { reserve: vi.fn().mockResolvedValue({ allowed: true, reservationId: 'r1' }), finalize: vi.fn().mockResolvedValue(undefined) };
    const fetchImpl = vi.fn().mockResolvedValue(validResponse());
    const result = await extractAndRecordCaptureOutcome(source, { credential, budget, fetchImpl }, vi.fn().mockRejectedValue(new Error('metadata-down')));
    expect(result).toEqual({ state: 'failed' }); expect(fetchImpl).toHaveBeenCalledOnce(); expect(budget.finalize).toHaveBeenCalledOnce();
  });
});
