import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodayOperatingBriefing } from './today-operating-briefing';
import type { TodayOperatingProjection } from '@/lib/application/today-operating-projection';

const projection: TodayOperatingProjection = {
  asOf: '2026-08-31T12:00:00.000Z', sourceState: 'available',
  priorityContributors: [{
    id: 'attention-1', priority: 'p0', category: 'transaction', reason: 'Inspection deadline is overdue.',
    href: '/transactions#deadline-1', evidenceCount: 2,
  }],
  approvals: { state: 'available', count: 2, topLabel: 'Call Alicia' },
  replies: { state: 'available', count: 1, topLabel: 'Alicia Rivera' },
  deadlines: { state: 'available', count: 3, overdue: 1, topLabel: 'Inspection · Alicia Rivera' },
  growth: { state: 'available', activeNurtures: 4, dueNurtures: 1 },
  connections: { state: 'available', connected: 2, needsAttention: 1, labels: ['Mailchimp'] },
  business: { state: 'available', activeTransactions: 2, underContract: 1 },
  unknowns: { count: 1, labels: ['Some transaction dates are not verified'] },
};

describe('TodayOperatingBriefing', () => {
  it('renders bounded human-readable workstreams and exact contributor destinations', () => {
    const html = renderToStaticMarkup(<TodayOperatingBriefing projection={projection} />);
    expect(html).toContain('One view of what can move the business today.');
    expect(html).toContain('Canonical attention queue');
    expect(html).toContain('Inspection deadline is overdue.');
    expect(html).toContain('2 verified contributors');
    expect(html).toContain('href="/transactions#deadline-1"');
    expect(html).toContain('Mailchimp needs attention');
    expect(html).toContain('Some transaction dates are not verified');
    expect(html).not.toContain('providerStatus');
    expect(html).not.toContain('priorityScore');
  });

  it('never presents an unavailable source as a verified zero', () => {
    const html = renderToStaticMarkup(<TodayOperatingBriefing projection={{
      ...projection,
      sourceState: 'unavailable',
      connections: { state: 'unavailable', connected: 0, needsAttention: 0, labels: [] },
    }} />);
    expect(html).toContain('Some sources unavailable');
    expect(html).toContain('Could not verify this area right now');
    expect(html).toContain('>—<');
  });
});
