import { describe, expect, it } from 'vitest';
import { buildPipelineAnalytics } from './pipeline-analytics.ts';
import type { Contact } from './contact.ts';
import type { ActivityEvent } from './activity.ts';

const contact: Contact = { id: 'c-1', firstName: 'Ada', lastName: 'Lovelace', leadType: 'hot', relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'closed', tags: [], createdAt: '2026-01-01T00:00:00.000Z' };
const event: ActivityEvent = { id: 'e-1', workspaceId: 'w-1', type: 'pipeline-stage-changed', contactId: 'c-1', actorMembershipId: 'm-1', occurredAt: '2026-02-01T00:00:00.000Z', createdAt: '2026-02-01T00:00:00.000Z', idempotencyKey: 'move-1', metadata: { fromStage: 'new', toStage: 'closed' } };

describe('pipeline analytics', () => {
  it('declares numerator denominator window and duration evidence', () => {
    const report = buildPipelineAnalytics({ contacts: [contact], events: [event], from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    expect(report.conversion).toMatchObject({ status: 'available', numerator: 1, denominator: 1, percentage: 100 });
    expect(report.stageMetrics.find((metric) => metric.stage === 'closed')).toMatchObject({ averageDaysInStage: 28, evidenceCount: 1 });
  });
  it('returns insufficient evidence instead of zero percent', () => {
    const report = buildPipelineAnalytics({ contacts: [contact], events: [], from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' });
    expect(report.conversion).toMatchObject({ status: 'insufficient-evidence', percentage: null, denominator: 0 });
  });
});
