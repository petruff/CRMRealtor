import { describe, expect, it, vi } from 'vitest';
import { seedContacts } from '../data/seed.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import { materializeDueNurturePlans } from './nurture-materializer.ts';

describe('nurture scheduler materializer', () => {
  it('creates one pending proposal and completes the fenced step', async () => {
    const createSystem = vi.fn().mockResolvedValue({ proposalId: 'proposal-step-1', version: 1, noOp: false });
    const completeStep = vi.fn().mockResolvedValue({});
    const contact = seedContacts(new Date('2026-08-31T12:00:00.000Z'))[0]!;
    const result = await materializeDueNurturePlans(
      { createSystem, upsertRelationshipMemory: vi.fn() },
      {
        claimDue: vi.fn().mockResolvedValue([{ plan: {
          id: 'plan-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, contactId: contact.id,
          sourceProposalId: 'proposal-1', state: 'active', version: 2, cadenceDays: 30,
          currentStep: 0, maximumSteps: 12, nextStepAt: '2026-08-31T11:00:00.000Z',
          createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-31T11:00:00.000Z',
        }, fencingToken: 3 }]),
        completeStep,
      },
      SAMPLE_WORKSPACE_SCOPE, [contact], new Date('2026-08-31T12:00:00.000Z'), 'worker-1',
    );
    expect(result).toEqual({ claimed: 1, materialized: 1, noOps: 0 });
    expect(createSystem).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, expect.objectContaining({
      kind: 'task-create', idempotencyKey: 'nurture-step:plan-1:1', approvalMode: 'active-member',
    }));
    expect(completeStep).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, expect.objectContaining({
      planId: 'plan-1', fencingToken: 3, proposalId: 'proposal-step-1',
    }));
  });
});
