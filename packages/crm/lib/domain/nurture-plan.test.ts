import { describe, expect, it } from 'vitest';
import { nurturePlanDueAt, transitionNurturePlan, type NurturePlan } from './nurture-plan.ts';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const plan = (state: NurturePlan['state'] = 'active'): NurturePlan => ({
  id: 'plan-1', workspaceId: 'workspace-1', contactId: 'contact-1', sourceProposalId: 'proposal-1',
  state, version: 1, cadenceDays: 30, currentStep: 0, maximumSteps: 12,
  nextStepAt: '2026-08-31T11:00:00.000Z', createdAt: '2026-08-30T12:00:00.000Z',
  updatedAt: '2026-08-30T12:00:00.000Z',
});

describe('nurture plan lifecycle', () => {
  it('supports pause, resume, snooze and stop with monotonic versions', () => {
    const paused = transitionNurturePlan(plan(), { action: 'pause' }, NOW);
    expect(paused).toMatchObject({ state: 'paused', version: 2 });
    const resumed = transitionNurturePlan(paused, { action: 'resume' }, NOW);
    expect(resumed).toMatchObject({ state: 'active', version: 3, nextStepAt: NOW.toISOString() });
    const snoozed = transitionNurturePlan(resumed, {
      action: 'snooze', snoozedUntil: '2026-09-03T12:00:00.000Z',
    }, NOW);
    expect(snoozed).toMatchObject({ state: 'snoozed', version: 4, snoozedUntil: '2026-09-03T12:00:00.000Z' });
    const stopped = transitionNurturePlan(snoozed, { action: 'stop', stopReason: 'Client requested no further nurture.' }, NOW);
    expect(stopped).toMatchObject({ state: 'stopped', version: 5, stopReason: 'Client requested no further nurture.' });
  });

  it('exposes only genuinely due active or elapsed-snooze plans', () => {
    expect(nurturePlanDueAt(plan(), NOW)).toBe('2026-08-31T11:00:00.000Z');
    expect(nurturePlanDueAt({ ...plan('snoozed'), snoozedUntil: '2026-09-01T12:00:00.000Z' }, NOW)).toBeUndefined();
    expect(nurturePlanDueAt({ ...plan('snoozed'), snoozedUntil: '2026-08-31T11:30:00.000Z' }, NOW))
      .toBe('2026-08-31T11:30:00.000Z');
    expect(nurturePlanDueAt(plan('paused'), NOW)).toBeUndefined();
  });

  it('rejects invalid or terminal transitions', () => {
    expect(() => transitionNurturePlan(plan('paused'), { action: 'pause' }, NOW)).toThrow('Only a running');
    expect(() => transitionNurturePlan(plan(), { action: 'snooze', snoozedUntil: NOW.toISOString() }, NOW))
      .toThrow('must be in the future');
    expect(() => transitionNurturePlan(plan('stopped'), { action: 'stop', stopReason: 'Again' }, NOW))
      .toThrow('already terminal');
  });
});
