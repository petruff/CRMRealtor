import { OMNIX_COPILOT_SUPPORTED_EXAMPLES, parseOmnixCopilotQuestion } from '../domain/omnix-copilot.ts';

const ALLOWED_MODELS = new Set(['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022']);
const TIMEOUT_MS = 8_000;

export interface OmnixClaudeRouteResult {
  readonly state: 'available' | 'unconfigured' | 'failed';
  readonly query?: string;
  readonly model?: string;
  readonly reason?: 'missing-key' | 'invalid-model' | 'request-failed' | 'invalid-response';
}

interface ClaudeResponse { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }

export async function routeOmnixQuestionWithClaude(question: string, options: {
  readonly credential?: { readonly apiKey: string; readonly model: string; readonly dataPolicy: 'paid-private' };
  readonly fetchImpl?: typeof fetch;
} = {}): Promise<OmnixClaudeRouteResult> {
  const credential = options.credential;
  if (!credential?.apiKey.trim()) return { state: 'unconfigured', reason: 'missing-key' };
  if (!ALLOWED_MODELS.has(credential.model)) return { state: 'unconfigured', reason: 'invalid-model' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': credential.apiKey.trim(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: credential.model, max_tokens: 80, temperature: 0,
        system: [
          'You are a read-only CRM query router.',
          'Return JSON only: {"query":"one exact supported query"}.',
          'Never answer, request CRM data, combine queries, or invent an identifier.',
          `Supported forms: ${OMNIX_COPILOT_SUPPORTED_EXAMPLES.join(' | ')}`,
          'For a named person use: find contact <name>.',
          'For all stored details use: contact profile <name>.',
        ].join('\n'),
        messages: [{ role: 'user', content: question }],
      }),
    });
    if (!response.ok) return { state: 'failed', model: credential.model, reason: 'request-failed' };
    const payload = await response.json() as ClaudeResponse;
    const text = payload.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('').trim();
    if (!text) return { state: 'failed', model: credential.model, reason: 'invalid-response' };
    try {
      const decoded = JSON.parse(text) as { query?: unknown };
      if (typeof decoded.query !== 'string') throw new Error('invalid');
      const query = decoded.query.trim();
      parseOmnixCopilotQuestion(query);
      return { state: 'available', model: credential.model, query };
    } catch {
      return { state: 'failed', model: credential.model, reason: 'invalid-response' };
    }
  } catch {
    return { state: 'failed', model: credential.model, reason: 'request-failed' };
  } finally { clearTimeout(timer); }
}
