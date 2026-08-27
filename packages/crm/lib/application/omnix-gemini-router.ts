import { OMNIX_COPILOT_SUPPORTED_EXAMPLES, parseOmnixCopilotQuestion } from '../domain/omnix-copilot.ts';
import { OMNIX_AI_POLICY } from './omnix-ai-policy';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const ALLOWED_MODELS = new Set(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);

export type OmnixGeminiState = 'available' | 'unconfigured' | 'failed';

export interface OmnixGeminiRouteResult {
  readonly state: OmnixGeminiState;
  readonly query?: string;
  readonly model?: string;
  readonly reason?:
    | 'disabled'
    | 'missing-key'
    | 'paid-policy-required'
    | 'invalid-model'
    | 'budget-unavailable'
    | 'budget-exhausted'
    | 'request-failed'
    | 'invalid-response';
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
}

export interface OmnixGeminiRouterOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly credential?: {
    readonly apiKey: string;
    readonly model: string;
    readonly dataPolicy: 'paid-private';
  };
}

function configuration(
  env: NodeJS.ProcessEnv,
  credential?: OmnixGeminiRouterOptions['credential'],
): OmnixGeminiRouteResult & { apiKey?: string } {
  if (credential) {
    if (!credential.apiKey.trim()) return { state: 'unconfigured', reason: 'missing-key' };
    if (!ALLOWED_MODELS.has(credential.model)) return { state: 'unconfigured', reason: 'invalid-model' };
    return { state: 'available', model: credential.model, apiKey: credential.apiKey.trim() };
  }
  if (env.OMNIX_GEMINI_ENABLED !== 'true') return { state: 'unconfigured', reason: 'disabled' };
  if (env.OMNIX_GEMINI_DATA_POLICY !== 'paid-private') {
    return { state: 'unconfigured', reason: 'paid-policy-required' };
  }
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { state: 'unconfigured', reason: 'missing-key' };
  const model = env.OMNIX_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  if (!ALLOWED_MODELS.has(model)) return { state: 'unconfigured', reason: 'invalid-model' };
  return { state: 'available', model, apiKey };
}

function parseModelText(payload: GeminiResponse): string | undefined {
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) return undefined;
  try {
    const decoded = JSON.parse(text) as { query?: unknown };
    if (typeof decoded.query !== 'string') return undefined;
    const query = decoded.query.trim();
    parseOmnixCopilotQuestion(query);
    return query;
  } catch {
    return undefined;
  }
}

export async function routeOmnixQuestionWithGemini(
  question: string,
  options: OmnixGeminiRouterOptions = {},
): Promise<OmnixGeminiRouteResult> {
  const configured = configuration(options.env ?? process.env, options.credential);
  if (configured.state !== 'available' || !configured.apiKey || !configured.model) return configured;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OMNIX_AI_POLICY.requestTimeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(configured.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': configured.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: [
              'You are a read-only CRM query router.',
              'Return JSON only: {"query":"one exact supported query"}.',
              'Never answer the question, request data, combine queries, or invent an identifier.',
              `Supported forms: ${OMNIX_COPILOT_SUPPORTED_EXAMPLES.join(' | ')}`,
              'For a named person use: find contact <name>.',
              'For all stored details about one person use: contact profile <name>.',
            ].join('\n') }],
          },
          contents: [{ role: 'user', parts: [{ text: question }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0,
            maxOutputTokens: 80,
          },
        }),
      },
    );
    if (!response.ok) return { state: 'failed', model: configured.model, reason: 'request-failed' };
    const payload = await response.json() as GeminiResponse;
    const query = parseModelText(payload);
    return query
      ? {
        state: 'available', model: configured.model, query,
        ...(payload.usageMetadata?.promptTokenCount !== undefined ? { inputTokens: payload.usageMetadata.promptTokenCount } : {}),
        ...(payload.usageMetadata?.candidatesTokenCount !== undefined ? { outputTokens: payload.usageMetadata.candidatesTokenCount } : {}),
      }
      : { state: 'failed', model: configured.model, reason: 'invalid-response' };
  } catch {
    return { state: 'failed', model: configured.model, reason: 'request-failed' };
  } finally {
    clearTimeout(timer);
  }
}
