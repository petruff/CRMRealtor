export const AFFORDABILITY_SOURCE_TYPES = [
  'user-entered', 'provider-supplied', 'calculated', 'estimated', 'unknown',
] as const;

export type AffordabilitySourceType = (typeof AFFORDABILITY_SOURCE_TYPES)[number];
export type AffordabilityVerificationState = 'unverified' | 'verified';

export interface AffordabilityFact {
  readonly value?: number;
  readonly sourceType: AffordabilitySourceType;
  readonly sourceReference?: string;
  readonly asOfDate?: string;
  readonly verificationState: AffordabilityVerificationState;
  readonly assumption: boolean;
}

export interface AffordabilityInputs {
  readonly priceCents: AffordabilityFact;
  readonly downPaymentCents: AffordabilityFact;
  readonly loanTermMonths: AffordabilityFact;
  readonly annualRateBasisPoints: AffordabilityFact;
  readonly annualPropertyTaxCents: AffordabilityFact;
  readonly annualHomeInsuranceCents: AffordabilityFact;
  readonly annualFloodInsuranceCents: AffordabilityFact;
  readonly monthlyAssociationCents: AffordabilityFact;
  readonly monthlyAssessmentCents: AffordabilityFact;
  readonly monthlyMaintenanceCents: AffordabilityFact;
  readonly closingCostsCents: AffordabilityFact;
}

export type AffordabilityInputKey = keyof AffordabilityInputs;

export interface AffordabilityOutputs {
  readonly loanAmountCents?: number;
  readonly monthlyPrincipalInterestCents?: number;
  readonly monthlyPropertyTaxCents?: number;
  readonly monthlyHomeInsuranceCents?: number;
  readonly monthlyFloodInsuranceCents?: number;
  readonly monthlyAssociationCents?: number;
  readonly monthlyAssessmentCents?: number;
  readonly monthlyMaintenanceCents?: number;
  readonly estimatedMonthlyOwnershipCents?: number;
  readonly estimatedCashToCloseCents?: number;
  readonly unknowns: readonly AffordabilityInputKey[];
}

export interface AffordabilityScenario {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly contactId?: string;
  readonly transactionId?: string;
  readonly inputs: AffordabilityInputs;
  readonly outputs: AffordabilityOutputs;
  readonly disclaimer: string;
  readonly version: number;
  readonly createdByMembershipId: string;
  readonly updatedByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AffordabilityScenarioRevision {
  readonly id: string;
  readonly scenarioId: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly name: string;
  readonly inputs: AffordabilityInputs;
  readonly outputs: AffordabilityOutputs;
  readonly reasonCode: string;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
}

export interface UpsertAffordabilityScenarioInput {
  readonly scenarioId?: string;
  readonly expectedVersion: number;
  readonly name: string;
  readonly contactId?: string;
  readonly transactionId?: string;
  readonly inputs: AffordabilityInputs;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface AffordabilitySharePreviewInput {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly recipientName: string;
  readonly recipientAddress: string;
  readonly channel: 'email';
  readonly consentConfirmed: boolean;
  readonly previewPayload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface AffordabilityShareIntent {
  readonly id: string;
  readonly workspaceId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly recipientName: string;
  readonly recipientAddress: string;
  readonly channel: 'email';
  readonly consentConfirmed: true;
  readonly previewPayload: Readonly<Record<string, unknown>>;
  readonly status: 'previewed';
  readonly createdByMembershipId: string;
  readonly createdAt: string;
}

export interface AffordabilityComparison {
  readonly monthlyDifferenceCents?: number;
  readonly cashToCloseDifferenceCents?: number;
  readonly unknowns: {
    readonly left: readonly AffordabilityInputKey[];
    readonly right: readonly AffordabilityInputKey[];
  };
}

export const AFFORDABILITY_DISCLAIMER =
  'Planning estimate only. Not a lender, insurance, tax, appraisal, association, legal, or affordability quote or guarantee.';

function isValidDate(value: string | undefined): boolean {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateFact(key: AffordabilityInputKey, fact: AffordabilityFact): AffordabilityFact {
  if (!AFFORDABILITY_SOURCE_TYPES.includes(fact.sourceType)) throw new Error(`${key} source type is invalid.`);
  if (fact.value !== undefined && (!Number.isSafeInteger(fact.value) || fact.value < 0)) {
    throw new Error(`${key} must be a bounded non-negative integer.`);
  }
  if (fact.sourceType === 'unknown' && fact.value !== undefined) {
    throw new Error(`${key} cannot have a value when its source is unknown.`);
  }
  if (fact.sourceType !== 'unknown' && fact.value === undefined) {
    throw new Error(`${key} needs a value or an unknown source.`);
  }
  if (!isValidDate(fact.asOfDate)) throw new Error(`${key} as-of date is invalid.`);
  const sourceReference = fact.sourceReference?.trim().replace(/\s+/g, ' ').slice(0, 240) || undefined;
  if ((fact.sourceType === 'provider-supplied' || fact.verificationState === 'verified') && !sourceReference) {
    throw new Error(`${key} requires a source reference.`);
  }
  return { ...fact, sourceReference };
}

export function validateAffordabilityInputs(inputs: AffordabilityInputs): AffordabilityInputs {
  const result = {} as Record<AffordabilityInputKey, AffordabilityFact>;
  for (const key of Object.keys(inputs) as AffordabilityInputKey[]) result[key] = validateFact(key, inputs[key]);
  if (result.annualRateBasisPoints.value !== undefined && result.annualRateBasisPoints.value > 5_000) {
    throw new Error('Annual rate must be 50% or less.');
  }
  if (result.loanTermMonths.value !== undefined
    && (result.loanTermMonths.value < 1 || result.loanTermMonths.value > 600)) {
    throw new Error('Loan term must be between 1 and 600 months.');
  }
  if (result.priceCents.value !== undefined && result.downPaymentCents.value !== undefined
    && result.downPaymentCents.value > result.priceCents.value) {
    throw new Error('Down payment cannot exceed price.');
  }
  return result as unknown as AffordabilityInputs;
}

function monthly(annual: number | undefined): number | undefined {
  return annual === undefined ? undefined : Math.round(annual / 12);
}

export function calculateAffordability(inputs: AffordabilityInputs): AffordabilityOutputs {
  const valid = validateAffordabilityInputs(inputs);
  const unknowns = (Object.keys(valid) as AffordabilityInputKey[]).filter((key) => valid[key].value === undefined);
  const price = valid.priceCents.value;
  const down = valid.downPaymentCents.value;
  const term = valid.loanTermMonths.value;
  const rate = valid.annualRateBasisPoints.value;
  const loanAmountCents = price === undefined || down === undefined ? undefined : price - down;
  let monthlyPrincipalInterestCents: number | undefined;

  if (loanAmountCents !== undefined && term !== undefined && rate !== undefined) {
    const monthlyRate = rate / 10_000 / 12;
    monthlyPrincipalInterestCents = monthlyRate === 0
      ? Math.round(loanAmountCents / term)
      : Math.round(
        loanAmountCents * (monthlyRate * Math.pow(1 + monthlyRate, term))
        / (Math.pow(1 + monthlyRate, term) - 1),
      );
  }

  const monthlyPropertyTaxCents = monthly(valid.annualPropertyTaxCents.value);
  const monthlyHomeInsuranceCents = monthly(valid.annualHomeInsuranceCents.value);
  const monthlyFloodInsuranceCents = monthly(valid.annualFloodInsuranceCents.value);
  const components = [
    monthlyPrincipalInterestCents, monthlyPropertyTaxCents, monthlyHomeInsuranceCents,
    monthlyFloodInsuranceCents, valid.monthlyAssociationCents.value,
    valid.monthlyAssessmentCents.value, valid.monthlyMaintenanceCents.value,
  ];
  const estimatedMonthlyOwnershipCents = components.every((item) => item !== undefined)
    ? components.reduce<number>((sum, item) => sum + (item ?? 0), 0)
    : undefined;
  const estimatedCashToCloseCents = down !== undefined && valid.closingCostsCents.value !== undefined
    ? down + valid.closingCostsCents.value
    : undefined;

  return {
    loanAmountCents,
    monthlyPrincipalInterestCents,
    monthlyPropertyTaxCents,
    monthlyHomeInsuranceCents,
    monthlyFloodInsuranceCents,
    monthlyAssociationCents: valid.monthlyAssociationCents.value,
    monthlyAssessmentCents: valid.monthlyAssessmentCents.value,
    monthlyMaintenanceCents: valid.monthlyMaintenanceCents.value,
    estimatedMonthlyOwnershipCents,
    estimatedCashToCloseCents,
    unknowns,
  };
}

export function validateAffordabilityScenarioInput(input: UpsertAffordabilityScenarioInput):
UpsertAffordabilityScenarioInput & { readonly disclaimer: string; readonly outputs: AffordabilityOutputs } {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error('Scenario version is invalid.');
  }
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new Error('Scenario name is required.');
  const inputs = validateAffordabilityInputs(input.inputs);
  const reasonCode = input.reasonCode.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
  if (!reasonCode) throw new Error('Scenario change reason is required.');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey)) {
    throw new Error('Scenario idempotency key is invalid.');
  }
  return { ...input, name, inputs, reasonCode, disclaimer: AFFORDABILITY_DISCLAIMER, outputs: calculateAffordability(inputs) };
}

export function validateAffordabilitySharePreview(input: AffordabilitySharePreviewInput): AffordabilitySharePreviewInput {
  if (!input.consentConfirmed) throw new Error('Confirmed client consent is required before creating a sharing preview.');
  if (!Number.isSafeInteger(input.scenarioVersion) || input.scenarioVersion < 1) throw new Error('Scenario version is invalid.');
  if (!input.recipientName.trim()) throw new Error('Recipient name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipientAddress.trim())) throw new Error('Recipient email is invalid.');
  if (input.channel !== 'email') throw new Error('Only governed email previews are supported.');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.idempotencyKey)) throw new Error('Sharing idempotency key is invalid.');
  return {
    ...input,
    recipientName: input.recipientName.trim().replace(/\s+/g, ' ').slice(0, 120),
    recipientAddress: input.recipientAddress.trim().toLowerCase(),
  };
}

export function compareAffordability(left: AffordabilityScenario, right: AffordabilityScenario): AffordabilityComparison {
  return {
    monthlyDifferenceCents: left.outputs.estimatedMonthlyOwnershipCents === undefined
      || right.outputs.estimatedMonthlyOwnershipCents === undefined
      ? undefined
      : right.outputs.estimatedMonthlyOwnershipCents - left.outputs.estimatedMonthlyOwnershipCents,
    cashToCloseDifferenceCents: left.outputs.estimatedCashToCloseCents === undefined
      || right.outputs.estimatedCashToCloseCents === undefined
      ? undefined
      : right.outputs.estimatedCashToCloseCents - left.outputs.estimatedCashToCloseCents,
    unknowns: { left: left.outputs.unknowns, right: right.outputs.unknowns },
  };
}
