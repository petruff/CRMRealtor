import { randomUUID } from 'node:crypto';
import { estimateOmnixCostMicrousd, estimateOmnixTokens, OMNIX_AI_POLICY, OMNIX_AI_POLICY_VERSION } from './omnix-ai-policy.ts';
import type { OmnixAiBudgetAuthority } from './omnix-generative-narrator.ts';
import {
  checkListingCopy,
  listingPrompt,
  templateListingCopy,
  type ListingFacts,
  type ListingFormat,
  type ListingLanguage,
} from '../domain/listing-writer.ts';
import type { FairHousingFinding } from '../domain/fair-housing.ts';

export interface ListingCopyResult {
  readonly text: string;
  readonly source: 'ai' | 'template';
  readonly findings: readonly FairHousingFinding[];
  /** Why AI wasn't used, in plain words (template results only). */
  readonly note?: string;
}

export interface ListingWriterOptions {
  readonly credential?: { readonly apiKey: string; readonly model: string; readonly provider: string };
  readonly budget?: OmnixAiBudgetAuthority;
  readonly fetchImpl?: typeof fetch;
}

const ALLOWED_MODELS = new Set(['gemini-3.5-flash-lite', 'gemini-3.6-flash']);
const OUTPUT_TOKENS = 560;

interface GeminiPayload {
  readonly candidates?: readonly { readonly finishReason?: string; readonly content?: { readonly parts?: readonly { readonly text?: string; readonly thought?: boolean }[] } }[];
  readonly usageMetadata?: { readonly promptTokenCount?: number; readonly candidatesTokenCount?: number; readonly thoughtsTokenCount?: number };
}

function template(facts: ListingFacts, format: ListingFormat, language: ListingLanguage, note?: string): ListingCopyResult {
  const checked = checkListingCopy(templateListingCopy(facts, format, language), format);
  return { text: checked.text, source: 'template', findings: checked.findings, ...(note ? { note } : {}) };
}

/**
 * Writes listing copy with Gemini when the workspace has AI connected and
 * budget left; otherwise returns the built-in template. Every result passes the
 * Fair Housing check; flagged AI copy falls back to the template.
 */
export async function writeListingCopy(facts: ListingFacts, format: ListingFormat, language: ListingLanguage, options: ListingWriterOptions = {}): Promise<ListingCopyResult> {
  const credential = options.credential;
  if (!credential || credential.provider !== 'google-gemini' || !ALLOWED_MODELS.has(credential.model) || !options.budget) {
    return template(facts, format, language, 'Written from your facts with the built-in template. Connect AI in Settings for richer copy.');
  }
  const prompt = listingPrompt(facts, format, language);
  const estimatedInput = estimateOmnixTokens(prompt.system + prompt.user);
  const estimated = Math.min(OMNIX_AI_POLICY.perRunBudgetMicrousd, estimateOmnixCostMicrousd(estimatedInput, OUTPUT_TOKENS));
  const reservation = await options.budget.reserve({
    correlationId: randomUUID(), policyVersion: OMNIX_AI_POLICY_VERSION, estimatedCostMicrousd: estimated,
    perRunLimitMicrousd: OMNIX_AI_POLICY.perRunBudgetMicrousd, dailyLimitMicrousd: OMNIX_AI_POLICY.dailyWorkspaceBudgetMicrousd,
  }).catch(() => ({ allowed: false as const, reason: 'unavailable' as const }));
  if (!reservation.allowed || !reservation.reservationId) {
    return template(facts, format, language, reservation.reason === 'exhausted' ? 'Today’s AI budget is used up, so this uses the built-in template.' : 'AI is unavailable right now, so this uses the built-in template.');
  }
  const reservationId = reservation.reservationId;
  let inputTokens = estimatedInput; let outputTokens = OUTPUT_TOKENS; let succeeded = false; let errorCategory = 'request-failed';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(credential.model)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': credential.apiKey.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'minimal' } },
        }),
      },
    );
    if (!response.ok) throw new Error('provider-failed');
    const payload = await response.json() as GeminiPayload;
    const usage = payload.usageMetadata;
    if (Number.isSafeInteger(usage?.promptTokenCount)) inputTokens = Math.min(100_000, Number(usage?.promptTokenCount));
    if (Number.isSafeInteger(usage?.candidatesTokenCount)) outputTokens = Math.min(OMNIX_AI_POLICY.maxOutputTokens, Number(usage?.candidatesTokenCount) + Number(usage?.thoughtsTokenCount ?? 0));
    const candidate = payload.candidates?.[0];
    const raw = candidate?.content?.parts?.filter((part) => part.thought !== true).map((part) => part.text ?? '').join('').trim();
    if (candidate?.finishReason !== 'STOP' || !raw) { errorCategory = candidate?.finishReason === 'MAX_TOKENS' ? 'provider-max-tokens' : 'invalid-response'; throw new Error(errorCategory); }
    const checked = checkListingCopy(raw, format);
    if (checked.findings.some((finding) => finding.severity === 'avoid')) {
      errorCategory = 'fair-housing-blocked';
      throw new Error(errorCategory);
    }
    succeeded = true;
    return { text: checked.text, source: 'ai', findings: checked.findings };
  } catch {
    return template(facts, format, language, 'AI couldn’t finish this one, so this uses the built-in template. Try again in a moment.');
  } finally {
    clearTimeout(timer);
    await options.budget.finalize({
      reservationId,
      state: succeeded ? 'succeeded' : 'failed',
      inputTokens,
      outputTokens: Math.min(OMNIX_AI_POLICY.maxOutputTokens, outputTokens),
      actualCostMicrousd: Math.min(OMNIX_AI_POLICY.perRunBudgetMicrousd, estimateOmnixCostMicrousd(inputTokens, Math.min(OMNIX_AI_POLICY.maxOutputTokens, outputTokens))),
      ...(succeeded ? {} : { errorCategory: `listing-${errorCategory}` }),
    }).catch(() => undefined);
  }
}
