import { describe, expect, it } from 'vitest';
import { estimateOmnixCostMicrousd, estimateOmnixTokens, OMNIX_AI_POLICY } from './omnix-ai-policy';

describe('Omnix AI policy', () => {
  it('keeps conservative immutable run ceilings', () => {
    expect(OMNIX_AI_POLICY).toMatchObject({
      modelCallsPerRun: 2,
      maxCitations: 24,
      maxOutputTokens: 600,
      perRunBudgetMicrousd: 10_000,
    });
    expect(Object.isFrozen(OMNIX_AI_POLICY)).toBe(true);
  });

  it('estimates tokens and spend without accepting negative usage', () => {
    expect(estimateOmnixTokens('123456')).toBe(2);
    expect(estimateOmnixCostMicrousd(1_000, 600)).toBe(1_800);
    expect(estimateOmnixCostMicrousd(-10, -20)).toBe(0);
  });
});
