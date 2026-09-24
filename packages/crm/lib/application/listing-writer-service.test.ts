import { describe, expect, it, vi } from 'vitest';
import { writeListingCopy } from './listing-writer-service.ts';
import { parseListingFacts } from '../domain/listing-writer.ts';

const facts = parseListingFacts({ city: 'Doral', highlights: 'heated pool, impact windows', beds: '3' });
const credential = { apiKey: 'test-key', model: 'gemini-3.5-flash-lite', provider: 'google-gemini' };

function budget(allowed = true) {
  return {
    reserve: vi.fn(async () => (allowed ? { allowed: true as const, reservationId: 'r1' } : { allowed: false as const, reason: 'exhausted' as const })),
    finalize: vi.fn(async (input: unknown) => { void input; }),
  };
}

function gemini(text: string, finishReason = 'STOP') {
  return vi.fn(async () => new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 120, thoughtsTokenCount: 10 } }), { status: 200 }));
}

describe('writeListingCopy', () => {
  it('uses the template when AI is not connected', async () => {
    const result = await writeListingCopy(facts, 'mls', 'en');
    expect(result.source).toBe('template');
    expect(result.note).toMatch(/Connect AI/u);
  });

  it('uses the template without calling the model when the budget is used up', async () => {
    const fetchImpl = gemini('x');
    const result = await writeListingCopy(facts, 'mls', 'en', { credential, budget: budget(false) as never, fetchImpl });
    expect(result.source).toBe('template');
    expect(result.note).toMatch(/budget/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns AI copy and finalizes the budget as succeeded with measured usage', async () => {
    const b = budget();
    const fetchImpl = gemini('Welcome to this bright Doral home with a heated pool and impact windows.');
    const result = await writeListingCopy(facts, 'mls', 'en', { credential, budget: b as never, fetchImpl });
    expect(result).toMatchObject({ source: 'ai', findings: [] });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    expect(b.finalize).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'r1', state: 'succeeded', inputTokens: 300, outputTokens: 130 }));
  });

  it('falls back to the template when the model writes something that breaks Fair Housing', async () => {
    const b = budget();
    const result = await writeListingCopy(facts, 'mls', 'en', { credential, budget: b as never, fetchImpl: gemini('Adults only! Heated pool.') });
    expect(result.source).toBe('template');
    expect(b.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: 'failed', errorCategory: 'listing-fair-housing-blocked' }));
  });

  it('falls back and still finalizes when the output is truncated or the request fails', async () => {
    const b = budget();
    expect((await writeListingCopy(facts, 'email', 'es', { credential, budget: b as never, fetchImpl: gemini('Hola', 'MAX_TOKENS') })).source).toBe('template');
    expect((await writeListingCopy(facts, 'email', 'es', { credential, budget: b as never, fetchImpl: vi.fn(async () => new Response('no', { status: 500 })) })).source).toBe('template');
    expect(b.finalize).toHaveBeenCalledTimes(2);
    expect(b.finalize.mock.calls.every(([call]) => (call as { outputTokens: number }).outputTokens <= 600)).toBe(true);
  });

  it('never uses a model outside the allowed list', async () => {
    const fetchImpl = gemini('x');
    const result = await writeListingCopy(facts, 'mls', 'en', { credential: { ...credential, model: 'gemini-ultra' }, budget: budget() as never, fetchImpl });
    expect(result.source).toBe('template');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
