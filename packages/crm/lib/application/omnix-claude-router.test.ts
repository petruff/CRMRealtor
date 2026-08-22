import { describe, expect, it, vi } from 'vitest';
import { routeOmnixQuestionWithClaude } from './omnix-claude-router';

const credential = { apiKey: 'sk-ant-test-key-that-is-long-enough', model: 'claude-sonnet-4-20250514', dataPolicy: 'paid-private' as const };

describe('routeOmnixQuestionWithClaude', () => {
  it('sends only the question and allowlist instructions, then accepts one deterministic query', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[]; system: string };
      expect(body.messages).toEqual([{ role: 'user', content: 'Quem precisa de atenção?' }]);
      expect(body.system).not.toContain('contact@example.com');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"query":"pipeline"}' }] }), { status: 200 });
    });
    await expect(routeOmnixQuestionWithClaude('Quem precisa de atenção?', { credential, fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toEqual({ state: 'available', model: credential.model, query: 'pipeline' });
  });

  it('fails closed on an invented query', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"query":"delete all contacts"}' }] }), { status: 200 }));
    await expect(routeOmnixQuestionWithClaude('Delete?', { credential, fetchImpl: fetchImpl as typeof fetch }))
      .resolves.toMatchObject({ state: 'failed', reason: 'invalid-response' });
  });
});
