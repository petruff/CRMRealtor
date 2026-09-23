/** Operational metadata only. Never add prompts, recaps, generated prose or provider bodies here. */
export interface CaptureRunTelemetry {
  readonly correlationId: string;
  readonly sourceHash: string;
  readonly state: 'available' | 'unconfigured' | 'limited' | 'failed';
  readonly reason: 'not-configured' | 'budget-unavailable' | 'budget-denied' | 'complete' | 'model-failed' | 'finalization-failed';
  readonly policyVersion: string;
  readonly model?: string;
  readonly reservationId?: string;
  readonly durationMs: number;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly chargedUpperBoundMicrousd: number;
  readonly accounting: 'not-reserved' | 'upper-bound-finalized' | 'finalization-unavailable';
}
