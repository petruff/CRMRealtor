export const NURTURE_PLAN_STATES = ['active', 'paused', 'snoozed', 'stopped', 'completed'] as const;
export type NurturePlanState = (typeof NURTURE_PLAN_STATES)[number];
export type NurturePlanAction = 'pause' | 'resume' | 'snooze' | 'stop';

export interface NurturePlan {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly sourceProposalId: string;
  readonly state: NurturePlanState;
  readonly version: number;
  readonly cadenceDays: number;
  readonly currentStep: number;
  readonly maximumSteps: number;
  readonly nextStepAt?: string;
  readonly snoozedUntil?: string;
  readonly stopReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class NurturePlanError extends Error {
  readonly code: 'invalid-input' | 'conflict';
  constructor(code: NurturePlanError['code'], message: string) {
    super(message);
    this.name = 'NurturePlanError';
    this.code = code;
  }
}

function instant(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new NurturePlanError('invalid-input', `${field} is required.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new NurturePlanError('invalid-input', `${field} is invalid.`);
  return date.toISOString();
}

function reason(value: unknown): string {
  if (typeof value !== 'string') throw new NurturePlanError('invalid-input', 'stopReason is required.');
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new NurturePlanError('invalid-input', 'stopReason is invalid.');
  }
  return normalized;
}

export function transitionNurturePlan(
  plan: NurturePlan,
  input: { readonly action: NurturePlanAction; readonly snoozedUntil?: string; readonly stopReason?: string },
  now = new Date(),
): NurturePlan {
  const occurredAt = now.toISOString();
  if (input.action === 'pause') {
    if (plan.state !== 'active' && plan.state !== 'snoozed') throw new NurturePlanError('conflict', 'Only a running nurture plan can be paused.');
    return Object.freeze({ ...plan, state: 'paused', version: plan.version + 1, snoozedUntil: undefined, updatedAt: occurredAt });
  }
  if (input.action === 'resume') {
    if (plan.state !== 'paused' && plan.state !== 'snoozed') throw new NurturePlanError('conflict', 'Only a paused or snoozed nurture plan can be resumed.');
    return Object.freeze({ ...plan, state: 'active', version: plan.version + 1, snoozedUntil: undefined,
      nextStepAt: plan.nextStepAt && Date.parse(plan.nextStepAt) > now.getTime() ? plan.nextStepAt : occurredAt,
      updatedAt: occurredAt });
  }
  if (input.action === 'snooze') {
    if (plan.state !== 'active') throw new NurturePlanError('conflict', 'Only an active nurture plan can be snoozed.');
    const snoozedUntil = instant(input.snoozedUntil, 'snoozedUntil');
    if (Date.parse(snoozedUntil) <= now.getTime()) throw new NurturePlanError('invalid-input', 'snoozedUntil must be in the future.');
    return Object.freeze({ ...plan, state: 'snoozed', version: plan.version + 1, snoozedUntil, updatedAt: occurredAt });
  }
  if (!['active', 'paused', 'snoozed'].includes(plan.state)) throw new NurturePlanError('conflict', 'This nurture plan is already terminal.');
  return Object.freeze({ ...plan, state: 'stopped', version: plan.version + 1, nextStepAt: undefined,
    snoozedUntil: undefined, stopReason: reason(input.stopReason), updatedAt: occurredAt });
}

export function nurturePlanDueAt(plan: NurturePlan, now = new Date()): string | undefined {
  if (plan.state === 'snoozed') return plan.snoozedUntil && Date.parse(plan.snoozedUntil) <= now.getTime()
    ? plan.snoozedUntil : undefined;
  if (plan.state !== 'active' || !plan.nextStepAt || Date.parse(plan.nextStepAt) > now.getTime()) return undefined;
  return plan.nextStepAt;
}
