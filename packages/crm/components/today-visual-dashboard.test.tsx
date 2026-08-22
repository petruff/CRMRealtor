import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodayMetricLedger, TodayVisualDashboard } from '@/components/today-visual-dashboard';
import type { Contact } from '@/lib/domain/contact';
import type { TriageSummary } from '@/lib/domain/triage';

function contact(
  id: string,
  leadType: Contact['leadType'],
  pipelineStage: Contact['pipelineStage'],
): Contact {
  return {
    id,
    firstName: `Contact ${id}`,
    lastName: 'Example',
    leadType,
    relationship: 'lead',
    intent: 'unknown',
    source: 'referral',
    pipelineStage,
    tags: [],
    createdAt: '2026-08-12T13:00:00.000Z',
  };
}

const CONTACTS = [
  contact('1', 'hot', 'active'),
  contact('2', 'hot', 'under-contract'),
  contact('3', 'warm', 'contacted'),
  contact('4', 'nurture', 'new'),
  contact('5', 'nurture', 'new'),
];

const SUMMARY: TriageSummary = {
  needsAttentionNow: 3,
  overdueCount: 1,
  dueTodayCount: 1,
  celebrationCount: 0,
  byLeadType: { hot: 1, warm: 1, nurture: 1 },
};

describe('Today visual dashboard', () => {
  it('renders a truthful navigable metric ledger from stored contacts', () => {
    const html = renderToStaticMarkup(<TodayMetricLedger contacts={CONTACTS} summary={SUMMARY} />);
    expect(html).toContain('Relationship book');
    expect(html).toContain('Relationship book: 5. stored contacts');
    expect(html).toContain('Need attention: 3. first touch or follow-up');
    expect(html).toContain('Hot relationships: 2. highest priority');
    expect(html).toContain('Active pipeline: 2. appointment through contract');
    expect(html).toContain('href="/alerts"');
    expect(html).toContain('href="/pipeline"');
  });

  it('maps lead temperature and every pipeline stage without invented business data', () => {
    const html = renderToStaticMarkup(<TodayVisualDashboard contacts={CONTACTS} />);
    expect(html).toContain('Relationship orbit');
    expect(html).toContain('2 Hot, 1 Warm, and 2 Nurture contacts');
    expect(html).toContain('--today-hot-end:40%');
    expect(html).toContain('--today-warm-end:60%');
    expect(html).toContain('Actively working: 1');
    expect(html).toContain('Under contract: 1');
    expect(html).toContain('Closed: 0');
    expect(html).toContain('Stored stages only');
    expect(html).not.toContain('revenue');
    expect(html).not.toContain('forecast');
    expect(html).not.toContain('conversion');
  });
});
