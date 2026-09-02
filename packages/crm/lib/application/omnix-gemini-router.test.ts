import { describe, expect, it, vi } from 'vitest';
import { routeOmnixQuestionWithGemini } from './omnix-gemini-router';

const enabled = {
  NODE_ENV: 'test',
  OMNIX_GEMINI_ENABLED: 'true',
  OMNIX_GEMINI_DATA_POLICY: 'paid-private',
  OMNIX_GEMINI_MODEL: 'gemini-3.5-flash-lite',
  GEMINI_API_KEY: 'server-secret',
} satisfies NodeJS.ProcessEnv;

describe('routeOmnixQuestionWithGemini', () => {
  it('fails closed unless the paid-private policy is explicit', async () => {
    await expect(routeOmnixQuestionWithGemini('Who needs attention?', {
      env: { ...enabled, OMNIX_GEMINI_DATA_POLICY: 'free' },
    })).resolves.toEqual({ state: 'unconfigured', reason: 'paid-policy-required' });
  });

  it('routes to one query that is reparsed by the deterministic grammar', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('server-secret');
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      expect(body.contents[0]?.parts[0]?.text).toBe('Quem precisa de atenção hoje?');
      expect(String(init?.body)).not.toContain('workspaceId');
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"query":"alerts today"}' }] } }],
      }), { status: 200 });
    }) as typeof fetch;

    await expect(routeOmnixQuestionWithGemini('Quem precisa de atenção hoje?', {
      env: enabled,
      fetchImpl,
    })).resolves.toEqual({
      state: 'available',
      model: 'gemini-3.5-flash-lite',
      query: 'alerts today',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects combined or invented model output without executing it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"query":"pipeline and mailers"}' }] } }],
    }), { status: 200 })) as typeof fetch;

    await expect(routeOmnixQuestionWithGemini('Show everything', {
      env: enabled,
      fetchImpl,
    })).resolves.toEqual({
      state: 'failed',
      model: 'gemini-3.5-flash-lite',
      reason: 'invalid-response',
    });
  });

  it('returns no CRM route for a valid public research classification', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 2 },
      candidates: [{ content: { parts: [{ text: '{"query":null}' }] } }],
    }), { status: 200 })) as typeof fetch;

    await expect(routeOmnixQuestionWithGemini('What changed in mortgage rates today?', {
      env: enabled,
      fetchImpl,
    })).resolves.toEqual({
      state: 'available',
      model: 'gemini-3.5-flash-lite',
      inputTokens: 25,
      outputTokens: 2,
    });
  });

  it('does not retry failed provider requests', async () => {
    const fetchImpl = vi.fn(async () => new Response('unavailable', { status: 503 })) as typeof fetch;
    await expect(routeOmnixQuestionWithGemini('What matters?', {
      env: enabled,
      fetchImpl,
    })).resolves.toMatchObject({ state: 'failed', reason: 'request-failed' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
