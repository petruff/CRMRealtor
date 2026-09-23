import { describe, expect, it, vi } from 'vitest';
import { captureInstant, CAPTURE_SCHEMA_VERSION } from '../domain/capture-outcome';
import { validateCaptureExtraction, captureTaskFlags, extractCaptureOutcome } from './capture-outcome-extraction';
const source = 'Not ready. Do not text. Client will call. I will send. May list next year.';
const span = (quote: string) => ({ quote, start: source.indexOf(quote), end: source.indexOf(quote) + quote.length });
const base = { schemaVersion: CAPTURE_SCHEMA_VERSION, summary: 'Review conversation intent.', facts: [], tasks: [], unknowns: [] };
const credential = { apiKey: 'test-key', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' as const };
describe('Capture strict extraction and fallback', () => {
  it.each(['Not ready.', 'Do not text.', 'Client will call.', 'I will send.', 'May list next year.'])('retains negation, ownership and timing verbatim: %s', (quote) => {
    const result = validateCaptureExtraction({ ...base, facts: [{ category: quote === 'Do not text.' ? 'consent' : 'commitment', text: quote, evidence: span(quote), confidence: 'high', uncertain: quote.includes('May') }] }, source);
    expect(result.facts[0]!.text).toBe(quote); expect(result.facts[0]!.evidence.quote).toBe(quote);
  });
  it('rejects paraphrased factual negation, forged spans, extra operations and invalid schema', () => {
    const fact = { category: 'consent', text: 'Ready.', evidence: span('Not ready.'), confidence: 'high', uncertain: false };
    expect(() => validateCaptureExtraction({ ...base, facts: [fact] }, source)).toThrow('exact source');
    expect(() => validateCaptureExtraction({ ...base, facts: [{ ...fact, text: 'Not ready.', evidence: { quote: 'Not ready.', start: 9, end: 19 } }] }, source)).toThrow('evidence');
    expect(() => validateCaptureExtraction({ ...base, execute: 'send-sms' }, source)).toThrow('unsupported');
    expect(() => validateCaptureExtraction({ ...base, schemaVersion: 'other' }, source)).toThrow('schema');
  });
  it.each(['2026-02-30T12:00:00Z', 'tomorrow', '2026-09-08', '2026-09-08T12:00:00', '2026-09-08T24:00:00Z'])('never silently normalizes invalid or ambiguous dates: %s', (date) => {
    expect(() => captureInstant(date)).toThrow();
  });
  it('requires task editing for client commitments, ambiguous dates, low confidence and negation', () => {
    const flags = captureTaskFlags({ title: 'Call', dueAt: null, owner: 'client', evidence: span('Client will call.'), confidence: 'medium', uncertain: false });
    expect(flags).toEqual(expect.arrayContaining(['owner-client', 'clarify-date', 'clarify-commitment', 'confirm-confidence']));
    expect(captureTaskFlags({ title: 'Send', dueAt: '2026-09-08T12:00:00Z', owner: 'realtor', evidence: span('I will send.'), confidence: 'high', uncertain: false })).toContain('confirm-date');
  });
  it('does not invoke a model when missing credential, missing budget or denied budget', async () => {
    const fetchImpl = vi.fn();
    expect(await extractCaptureOutcome(source, { fetchImpl })).toMatchObject({ state: 'unconfigured' });
    expect(await extractCaptureOutcome(source, { credential, fetchImpl })).toMatchObject({ state: 'limited' });
    const budget = { reserve: vi.fn().mockRejectedValue(new Error('unavailable')), finalize: vi.fn() };
    expect(await extractCaptureOutcome(source, { credential, budget, fetchImpl })).toMatchObject({ state: 'limited' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['not json', JSON.stringify({ refusal: 'No' }), 'x'.repeat(61000)])('fails invalid/refused/oversized model output and finalizes reservation', async (body) => {
    const budget = { reserve: vi.fn().mockResolvedValue({ allowed: true, reservationId: 'reserved' }), finalize: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body));
    expect(await extractCaptureOutcome(source, { credential, budget, fetchImpl })).toMatchObject({ state: 'failed' });
    expect(budget.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed', reservationId: 'reserved' }));
  });
  it('accepts schema-valid grounded output and performs no tools or CRM requests', async () => {
    const budget = { reserve: vi.fn().mockResolvedValue({ allowed: true, reservationId: 'reserved' }), finalize: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(base) }] } }] })));
    expect((await extractCaptureOutcome(source, { credential, budget, fetchImpl })).state).toBe('available');
    const request = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(request).not.toHaveProperty('tools'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
