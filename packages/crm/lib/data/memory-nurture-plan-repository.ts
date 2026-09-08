import { transitionNurturePlan, type NurturePlan } from '../domain/nurture-plan.ts';
import type { NurturePlanRepository } from './nurture-plan-repository.ts';

export function createMemoryNurturePlanRepository(): NurturePlanRepository {
  const plans: NurturePlan[] = [];
  const keys = new Map<string, string>();
  const transitionReceipts = new Map<string, { fingerprint: string; plan: NurturePlan }>();
  let sequence = 1;
  return {
    async list(scope, input) {
      return plans.filter((plan) => plan.workspaceId === scope.workspaceId)
        .filter((plan) => !input.contactId || plan.contactId === input.contactId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, input.limit);
    },
    async get(scope, planId) {
      return plans.find((plan) => plan.workspaceId === scope.workspaceId && plan.id === planId);
    },
    async create(scope, input) {
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const existingId = keys.get(key);
      if (existingId) return plans.find((plan) => plan.id === existingId)!;
      if (plans.some((plan) => plan.workspaceId === scope.workspaceId && plan.contactId === input.contactId
        && ['active', 'paused', 'snoozed'].includes(plan.state))) throw new Error('Contact already has a current nurture plan.');
      const plan: NurturePlan = {
        id: `nurture-plan-${sequence++}`, workspaceId: scope.workspaceId, contactId: input.contactId,
        sourceProposalId: input.sourceProposalId, state: 'active', version: 1,
        cadenceDays: input.cadenceDays, currentStep: 0, maximumSteps: input.maximumSteps,
        nextStepAt: new Date(input.startAt).toISOString(), createdAt: new Date(input.occurredAt).toISOString(),
        updatedAt: new Date(input.occurredAt).toISOString(),
      };
      plans.push(plan); keys.set(key, plan.id); return plan;
    },
    async transition(scope, planId, input) {
      const key = `${scope.workspaceId}:${input.idempotencyKey}`;
      const fingerprint = JSON.stringify({ planId, expectedVersion: input.expectedVersion, action: input.action, snoozedUntil: input.snoozedUntil, stopReason: input.stopReason });
      const previous = transitionReceipts.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('Nurture transition idempotency conflict.');
        return previous.plan;
      }
      const index = plans.findIndex((plan) => plan.workspaceId === scope.workspaceId && plan.id === planId);
      if (index < 0) throw new Error('Nurture plan was not found.');
      const current = plans[index]!;
      if (current.version !== input.expectedVersion) throw new Error('Nurture plan version conflict.');
      const next = transitionNurturePlan(current, input, new Date(input.occurredAt));
      plans[index] = next;
      transitionReceipts.set(key, { fingerprint, plan: next });
      return next;
    },
  };
}
