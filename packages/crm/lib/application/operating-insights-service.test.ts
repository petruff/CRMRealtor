import { describe, expect, it } from 'vitest';
import { getOperatingInsights, type OperatingInsightsContext } from './operating-insights-service.ts';
import { memoryRepository } from '../data/memory-repository.ts';
import { createMemoryActivityRepository } from '../data/memory-activity-repository.ts';
import { createSampleWorkspaceRepository } from '../data/memory-workspace-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';

function context(): OperatingInsightsContext {
  return {
    repository: memoryRepository(),
    activityRepository: createMemoryActivityRepository(),
    workspaceRepository: createSampleWorkspaceRepository(true),
    workspaceScope: SAMPLE_WORKSPACE_SCOPE,
  };
}

describe('operating insights service', () => {
  it('returns the same complete contract consumed by CLI and UI at a fixed instant', async () => {
    const report = await getOperatingInsights(context(), { period: 30 }, new Date('2026-08-22T18:00:00.000Z'));
    expect(report).toMatchObject({
      schemaVersion: 'operating-insights.v1',
      periodDays: 30,
      currentWindow: { to: '2026-08-22T18:00:00.000Z' },
      portfolio: {
        status: 'available', totalContacts: 11,
        health: { needsAttention: expect.any(Number), progressing: expect.any(Number) },
        readiness: { withPhone: expect.any(Number), withEmail: expect.any(Number) },
      },
      finance: { status: 'unavailable' },
      coverage: { status: 'complete', truncated: false },
    });
  });

  it('fails closed when a required repository read fails', async () => {
    const base = context();
    const failing: OperatingInsightsContext = {
      ...base,
      repository: { ...base.repository, list: async () => { throw new Error('contact read unavailable'); } },
    };
    await expect(getOperatingInsights(failing, { period: 90 }, new Date('2026-08-22T18:00:00.000Z')))
      .rejects.toThrow('contact read unavailable');
  });
});
