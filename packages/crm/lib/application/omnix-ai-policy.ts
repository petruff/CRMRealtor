export const OMNIX_AI_POLICY_VERSION = 'omnix-ai-policy.v1' as const;

export const OMNIX_AI_POLICY = Object.freeze({
  modelCallsPerRun: 2,
  maxQuestionCharacters: 200,
  maxCitations: 24,
  maxContextCharacters: 12_000,
  maxOutputTokens: 600,
  maxProposals: 3,
  requestTimeoutMs: 7_000,
  runTimeoutMs: 15_000,
  perRunBudgetMicrousd: 10_000,
  dailyWorkspaceBudgetMicrousd: 1_000_000,
});

const GEMINI_FLASH_LITE_INPUT_MICROUSD_PER_TOKEN = 0.3;
const GEMINI_FLASH_LITE_OUTPUT_MICROUSD_PER_TOKEN = 2.5;

/** Conservative UTF-8-independent estimate used before provider dispatch. */
export function estimateOmnixTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 3));
}

export function estimateOmnixCostMicrousd(inputTokens: number, outputTokens: number): number {
  const safeInput = Math.max(0, Math.trunc(inputTokens));
  const safeOutput = Math.max(0, Math.trunc(outputTokens));
  return Math.ceil(
    (safeInput * GEMINI_FLASH_LITE_INPUT_MICROUSD_PER_TOKEN)
    + (safeOutput * GEMINI_FLASH_LITE_OUTPUT_MICROUSD_PER_TOKEN),
  );
}
