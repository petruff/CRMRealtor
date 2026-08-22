import { describe, expect, it } from 'vitest';
import { buildPipelineAnalytics } from './pipeline-analytics.ts';
import type { Contact, PipelineStage } from './contact.ts';
import type { ActivityEvent } from './activity.ts';

function contact(id: string, pipelineStage: PipelineStage = 'closed'): Contact {
  return {
    id,
    firstName: 'Ada',
    lastName: id,
    leadType: 'hot',
    relationship: 'lead',
    intent: 'buyer',
    source: 'referral',
    pipelineStage,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function event(
  id: string,
  contactId: string | undefined,
  occurredAt: string,
  fromStage: PipelineStage,
  toStage: PipelineStage,
): ActivityEvent {
  return {
    id,
    workspaceId: 'w-1',
    type: 'pipeline-stage-changed',
    ...(contactId ? { contactId } : {}),
    actorMembershipId: 'm-1',
    occurredAt,
    createdAt: occurredAt,
    idempotencyKey: `move-${id}`,
    metadata: { fromStage, toStage },
  };
}

const window = {
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-03-01T00:00:00.000Z',
};

describe('pipeline analytics', () => {
  it('uses a unique same-contact cohort so conversion cannot exceed 100 percent', () => {
    const events = [
      event('1', 'c-1', '2026-01-05T00:00:00.000Z', 'new', 'contacted'),
      event('2', 'c-1', '2026-02-01T00:00:00.000Z', 'contacted', 'closed'),
      event('3', 'c-1', '2026-02-10T00:00:00.000Z', 'lost', 'closed'),
      event('4', 'c-2', '2026-02-15T00:00:00.000Z', 'contacted', 'closed'),
    ];
    const report = buildPipelineAnalytics({ contacts: [contact('c-1'), contact('c-2')], events, ...window });

    expect(report.conversion).toMatchObject({
      status: 'available',
      numerator: 1,
      denominator: 1,
      percentage: 100,
    });
    expect(report.conversion.percentage).toBeLessThanOrEqual(100);
  });

  it('does not count a close that happened before the contact entered the eligible cohort', () => {
    const events = [
      event('1', 'c-1', '2026-01-05T00:00:00.000Z', 'contacted', 'closed'),
      event('2', 'c-1', '2026-02-01T00:00:00.000Z', 'new', 'contacted'),
    ];
    const report = buildPipelineAnalytics({ contacts: [contact('c-1', 'contacted')], events, ...window });

    expect(report.conversion).toMatchObject({ numerator: 0, denominator: 1, percentage: 0 });
  });

  it('never counts an equal-timestamp close regardless of event id ordering', () => {
    const occurredAt = '2026-02-01T00:00:00.000Z';
    const report = buildPipelineAnalytics({
      contacts: [contact('c-1')],
      events: [
        event('a-new-exit', 'c-1', occurredAt, 'new', 'contacted'),
        event('z-close', 'c-1', occurredAt, 'contacted', 'closed'),
      ],
      ...window,
    });

    expect(report.conversion).toMatchObject({
      numerator: 0,
      denominator: 1,
      percentage: 0,
      eligibleContactIds: ['c-1'],
      closedContactIds: [],
    });
  });

  it('ages from the latest transition into the current stage, not a later transition out', () => {
    const events = [
      event('1', 'c-1', '2026-02-01T00:00:00.000Z', 'contacted', 'closed'),
      event('2', 'c-1', '2026-02-15T00:00:00.000Z', 'closed', 'lost'),
      event('3', 'c-1', '2026-03-02T00:00:00.000Z', 'lost', 'closed'),
    ];
    const report = buildPipelineAnalytics({ contacts: [contact('c-1')], events, ...window });

    expect(report.stageMetrics.find((metric) => metric.stage === 'closed')).toMatchObject({
      averageDaysInStage: 28,
      evidenceCount: 1,
      contributors: [{ recordId: 'c-1', href: '/contacts/c-1', daysInStage: 28 }],
    });
  });

  it('returns insufficient evidence instead of zero percent when no cohort exists', () => {
    const report = buildPipelineAnalytics({ contacts: [contact('c-1')], events: [], ...window });

    expect(report.conversion).toMatchObject({
      status: 'insufficient-evidence',
      percentage: null,
      denominator: 0,
    });
  });

  it('reports possible truncation when the repository bound is reached', () => {
    const events = [
      event('1', 'c-1', '2026-01-05T00:00:00.000Z', 'new', 'contacted'),
      event('2', 'c-1', '2026-02-01T00:00:00.000Z', 'contacted', 'closed'),
    ];
    const report = buildPipelineAnalytics({
      contacts: [contact('c-1')],
      events,
      ...window,
      boundedAt: 2,
    });

    expect(report.evidence).toMatchObject({
      observedEvents: 2,
      boundedAt: 2,
      coverage: 'possibly-truncated',
      truncated: true,
    });
  });
});
