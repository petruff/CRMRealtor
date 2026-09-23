import { describe, expect, it } from 'vitest';
import {
  calculateAffordability,
  compareAffordability,
  validateAffordabilityScenarioInput,
  validateAffordabilitySharePreview,
  type AffordabilityFact,
  type AffordabilityInputs,
  type AffordabilityScenario,
} from './affordability';

const fact = (
  value: number | undefined,
  sourceType: AffordabilityFact['sourceType'] = 'user-entered',
): AffordabilityFact => ({
  value,
  sourceType,
  sourceReference: sourceType === 'unknown' ? undefined : 'Owner entry',
  asOfDate: '2026-08-31',
  verificationState: 'unverified',
  assumption: true,
});

const INPUTS: AffordabilityInputs = {
  priceCents: fact(50_000_000), downPaymentCents: fact(10_000_000), loanTermMonths: fact(360),
  annualRateBasisPoints: fact(600), annualPropertyTaxCents: fact(600_000),
  annualHomeInsuranceCents: fact(240_000), annualFloodInsuranceCents: fact(120_000),
  monthlyAssociationCents: fact(50_000), monthlyAssessmentCents: fact(10_000),
  monthlyMaintenanceCents: fact(30_000), closingCostsCents: fact(1_500_000),
};

describe('affordability scenario engine', () => {
  it('reproduces financed monthly ownership and cash to close by component', () => {
    const output = calculateAffordability(INPUTS);
    expect(output.loanAmountCents).toBe(40_000_000);
    expect(output.monthlyPrincipalInterestCents).toBe(239_820);
    expect(output.estimatedMonthlyOwnershipCents).toBe(409_820);
    expect(output.estimatedCashToCloseCents).toBe(11_500_000);
  });

  it('preserves unknowns instead of filling them with zero', () => {
    const output = calculateAffordability({ ...INPUTS, annualFloodInsuranceCents: fact(undefined, 'unknown') });
    expect(output.monthlyFloodInsuranceCents).toBeUndefined();
    expect(output.estimatedMonthlyOwnershipCents).toBeUndefined();
    expect(output.unknowns).toContain('annualFloodInsuranceCents');
  });

  it('rejects unsafe or contradictory assumptions', () => {
    expect(() => calculateAffordability({ ...INPUTS, downPaymentCents: fact(60_000_000) })).toThrow(/exceed/);
    expect(() => calculateAffordability({ ...INPUTS, annualRateBasisPoints: fact(5_001) })).toThrow(/50%/);
    expect(() => calculateAffordability({ ...INPUTS, priceCents: fact(-1) })).toThrow(/non-negative/);
  });

  it('compares exact outputs without ranking or guarantee semantics', () => {
    const base = validateAffordabilityScenarioInput({
      expectedVersion: 0, name: 'A', inputs: INPUTS, reasonCode: 'created', idempotencyKey: 'scenario:a',
    });
    const left = {
      id: 'a', workspaceId: 'w', ...base, version: 1, createdByMembershipId: 'm', updatedByMembershipId: 'm',
      createdAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z',
    } as AffordabilityScenario;
    const right = {
      ...left, id: 'b', name: 'B',
      outputs: { ...left.outputs, estimatedMonthlyOwnershipCents: left.outputs.estimatedMonthlyOwnershipCents! + 10_000 },
    };
    expect(compareAffordability(left, right).monthlyDifferenceCents).toBe(10_000);
    expect(base.disclaimer).toMatch(/Not a lender/);
  });

  it('requires exact recipient consent but never models a send', () => {
    expect(() => validateAffordabilitySharePreview({
      scenarioId: 'a', scenarioVersion: 1, recipientName: 'Client', recipientAddress: 'client@example.com',
      channel: 'email', consentConfirmed: false, previewPayload: {}, idempotencyKey: 'share:a',
    })).toThrow(/consent/);
    expect(validateAffordabilitySharePreview({
      scenarioId: 'a', scenarioVersion: 1, recipientName: ' Client ', recipientAddress: 'CLIENT@example.com',
      channel: 'email', consentConfirmed: true, previewPayload: {}, idempotencyKey: 'share:b',
    })).toMatchObject({ recipientName: 'Client', recipientAddress: 'client@example.com' });
  });
});
