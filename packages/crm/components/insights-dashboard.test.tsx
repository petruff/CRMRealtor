/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { InsightsDashboard, type InsightsDashboardModel } from '@/components/insights-dashboard';

const MODEL: InsightsDashboardModel = {
  periodDays: 90,
  generatedAt: '2026-08-22T18:00:00.000Z',
  isLive: true,
  portfolioStatus: 'available',
  pipelineStatus: 'available',
  sourceStatus: 'available',
  totalContacts: 191,
  needsAttention: 40,
  progressing: 8,
  underContract: 1,
  portfolio: { hot: 20, warm: 60, nurture: 111, overdue: 12, neverContacted: 7, needsQualification: 4 },
  pipeline: [
    { stage: 'new', label: 'New', count: 100, averageDaysInStage: 4.5, evidenceCount: 80, detailId: 'stage-new' },
    { stage: 'closed', label: 'Closed', count: 9, averageDaysInStage: null, evidenceCount: 0, detailId: 'stage-closed' },
  ],
  conversion: { status: 'available', numerator: 4, denominator: 10, percentage: 40, definition: 'Same-contact cohort.' },
  conversionChange: 5,
  previousTransitionEvents: 8,
  transitionEvents: 12,
  sources: [{ id: 'referral', label: 'Referral', count: 40, progressed: 10, progressionPercentage: 25, progressedChange: 2, detailId: 'source-referral' }],
  work: {
    status: 'available', open: 10, overdue: 2, dueSoon: 3, completed: 7, previousCompleted: 5,
    completionRate: 70, onTimeRate: 85.7,
    members: [
      { id: 'owner', label: 'Owner', role: 'owner', attribution: 'active-member', open: 6, overdue: 1, completed: 4 },
      { id: 'unassigned', label: 'Unassigned', role: null, attribution: 'unassigned', open: 1, overdue: 1, completed: 0 },
      { id: 'inactive', label: 'Inactive / unknown', role: null, attribution: 'inactive-or-unknown', open: 2, overdue: 0, completed: 1 },
    ],
  },
  readiness: [{ label: 'Phone on file', value: 150, detailId: 'readiness-phone' }],
  transactionStatus: 'available',
  transactionMetrics: {
    closedDeals: 1, closedVolumeCents: 42500000, grossCommissionCents: 1275000,
    netCommissionCents: 820000, trackedExpensesCents: 70000, netIncomeCents: 750000,
    activeForecastGciCents: 900000, averageSalePriceCents: 42500000,
    sourceMetrics: [{ source: 'referral', deals: 1, volumeCents: 42500000, netIncomeCents: 750000, marketingCostCents: 20000, roiPercentage: 3750 }],
  },
  financialMetrics: {
    booked: { deals: 1, volumeCents: 42500000, gciCents: 1275000, netCommissionCents: 820000, expensesCents: 70000, netIncomeCents: 750000 },
    activeForecast: { deals: 1, gciCents: 900000, assumption: 'unweighted-verified-gci' },
    excluded: { lostOrCancelled: 0, incomplete: 0, unverified: 0, contradictory: 0 },
    contributors: [{
      transactionId: 'transaction-1', transactionTitle: 'Morgan sale', source: 'referral', status: 'closed',
      effectiveDate: '2026-08-20', volumeCents: 42500000, gciCents: 1275000, netCommissionCents: 820000,
      expensesCents: 70000, netIncomeCents: 750000, verificationState: 'verified', missing: [],
    }],
  },
  transactions: [{
    id: 'transaction-1', workspaceId: 'workspace-live', contactId: '00000000-0000-4000-8000-000000000001',
    contactName: 'Morgan Ellis', kind: 'seller', kindVerified: true, title: 'Morgan sale',
    status: 'closed', side: 'seller', propertyAddress: '123 Main Street',
    source: 'referral', closedAt: '2026-08-20', salePriceCents: 42500000,
    grossCommissionCents: 1275000, netCommissionCents: 820000, marketingCostCents: 20000,
    expenseCents: 50000, responsibleMembershipId: 'membership-live', version: 1,
    createdByMembershipId: 'membership-live',
    createdAt: '2026-08-20T15:00:00.000Z', updatedAt: '2026-08-20T15:00:00.000Z',
  }],
  transactionContacts: [{ id: '00000000-0000-4000-8000-000000000001', label: 'Morgan Ellis' }],
  selectedDrilldownId: 'source-referral',
  drilldowns: [
    { id: 'portfolio-all', label: 'Relationship book', status: 'available', scope: 'snapshot', contributors: [{ entityType: 'contact', recordId: 'contact-all', label: 'Alex Morgan', href: '/contacts/contact-all' }] },
    { id: 'stage-new', label: 'New stage and aging', status: 'available', scope: 'snapshot', contributors: [{ entityType: 'contact', recordId: 'contact-new', label: 'Taylor Reed', href: '/contacts/contact-new', detail: '4.5 days in stage' }] },
    { id: 'stage-closed', label: 'Closed stage and aging', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'conversion-eligible', label: 'Conversion eligible cohort', status: 'available', scope: 'current-period', contributors: [{ entityType: 'contact', recordId: 'contact-cohort', label: 'Jordan Lane', href: '/contacts/contact-cohort', detail: 'Reached Closed strictly after leaving New' }] },
    { id: 'tasks-open', label: 'Open tasks', status: 'available', scope: 'snapshot', contributors: [{ entityType: 'task', recordId: 'task-open', label: 'Call Jordan', href: '/activities?status=all&q=Call%20Jordan', detail: 'Open task snapshot' }] },
    { id: 'tasks-overdue', label: 'Overdue tasks', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'tasks-due-soon', label: 'Tasks due next 7 days', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'tasks-completed', label: 'Tasks completed in period', status: 'available', scope: 'current-period', contributors: [] },
    { id: 'source-referral', label: 'Referral progressed cohort', status: 'available', scope: 'current-period', contributors: [{ entityType: 'contact', recordId: 'contact-referral', label: 'Morgan Ellis', href: '/contacts/contact-referral', detail: 'Referral; reached a qualifying stage in selected period' }] },
    { id: 'readiness-phone', label: 'Phone on file', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-attention', label: 'Needs attention now', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-progressing', label: 'Progressing relationships', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-hot', label: 'Hot relationships', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-warm', label: 'Warm relationships', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-nurture', label: 'Nurture relationships', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-overdue', label: 'Overdue follow-ups', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-needs-qualification', label: 'Needs qualification', status: 'available', scope: 'snapshot', contributors: [] },
    { id: 'portfolio-never-contacted', label: 'Never contacted', status: 'available', scope: 'snapshot', contributors: [] },
  ],
  coverage: {
    contactBoundedAt: 500, contactPossiblyTruncated: false,
    transitionBoundedAt: 500, transitionPossiblyTruncated: false,
    eventBoundedAt: 1500,
    taskBoundedAt: 500, taskPossiblyTruncated: false,
    schemaVersion: 'operating-insights.v1',
    currentFrom: '2026-05-24T18:00:00.000Z', currentTo: '2026-08-22T18:00:00.000Z',
    previousFrom: '2026-02-23T18:00:00.000Z', previousTo: '2026-05-24T17:59:59.999Z',
    contactRows: 191, transitionRows: 12, taskRows: 10, membershipRows: 2, mode: 'live',
  },
};

afterEach(cleanup);

describe('Insights dashboard', () => {
  it('mounts exact period-preserving drilldowns instead of generic destination links', () => {
    render(<InsightsDashboard model={MODEL} />);

    expect(screen.getByRole('link', { name: /Review exact Referral progression contributors/i }))
      .toHaveAttribute('href', '/insights?period=90&detail=source-referral#contributor-details');
    expect(screen.getByRole('link', { name: /Relationship book/i }))
      .toHaveAttribute('href', '/insights?period=90&detail=portfolio-all#contributor-details');
    expect(screen.getAllByRole('link', { name: /Cohort conversion/i }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          href: expect.stringContaining('/insights?period=90&detail=conversion-eligible#contributor-details'),
        }),
      ]));
    expect(screen.queryByRole('link', { name: /Review Referral contacts/i })).not.toBeInTheDocument();
  });

  it('provides an accessible mounted detail control and renders only the selected exact cohort', async () => {
    const user = userEvent.setup();
    render(<InsightsDashboard model={MODEL} />);
    const detailRegion = screen.getByRole('region', { name: 'Inspect the records behind one metric' });
    const selector = within(detailRegion).getByRole('combobox', { name: 'Metric detail' });

    expect(selector).toHaveValue('source-referral');
    expect(within(detailRegion).getByRole('link', { name: 'Open Morgan Ellis' })).toHaveAttribute('href', '/contacts/contact-referral');
    expect(within(detailRegion).queryByText('contact-referral')).not.toBeInTheDocument();
    expect(within(detailRegion).getByText(/90-day cohort/)).toBeInTheDocument();
    await user.selectOptions(selector, 'tasks-open');
    expect(selector).toHaveValue('tasks-open');
    expect(within(detailRegion).getByRole('link', { name: 'Open Call Jordan' })).toHaveAttribute('href', '/activities?status=all&q=Call%20Jordan');
    expect(window.location.search).toContain('detail=tasks-open');
  });

  it('keeps large exact sets bounded, searchable, filterable, and paginated', async () => {
    const user = userEvent.setup();
    const contributors = Array.from({ length: 25 }, (_, index) => ({
      entityType: 'contact' as const,
      recordId: `contact-${index + 1}`,
      label: `Person ${String(index + 1).padStart(2, '0')}`,
      href: `/contacts/contact-${index + 1}`,
      detail: index === 24 ? 'Priority referral relationship' : 'Stored relationship record',
    }));
    const drilldowns = MODEL.drilldowns.map((item) => item.id === 'portfolio-all' ? { ...item, contributors } : item);
    render(<InsightsDashboard model={{ ...MODEL, selectedDrilldownId: 'portfolio-all', drilldowns }} />);
    const detailRegion = screen.getByRole('region', { name: 'Inspect the records behind one metric' });

    expect(within(detailRegion).getAllByText('25', { selector: 'strong' }).length).toBeGreaterThanOrEqual(2);
    expect(within(detailRegion).getByText(/Showing/)).toHaveTextContent('Showing 1–12 of 25 exact records');
    expect(within(detailRegion).getAllByRole('link', { name: /Open Person/ })).toHaveLength(12);

    await user.click(within(detailRegion).getByRole('button', { name: /Next/ }));
    expect(within(detailRegion).getByText(/Showing/)).toHaveTextContent('Showing 13–24 of 25 exact records');

    await user.type(within(detailRegion).getByRole('textbox', { name: 'Find a contributor' }), 'Priority referral');
    expect(within(detailRegion).getByText(/Showing/)).toHaveTextContent('Showing 1–1 of 1 matching 25 exact records');
    expect(within(detailRegion).getByRole('link', { name: 'Open Person 25' })).toBeInTheDocument();

    await user.selectOptions(within(detailRegion).getByRole('combobox', { name: 'Record type' }), 'task');
    expect(within(detailRegion).getByText('No matching contributors')).toBeInTheDocument();
    await user.click(within(detailRegion).getByRole('button', { name: 'Clear filters' }));
    expect(within(detailRegion).getByText(/Showing/)).toHaveTextContent('Showing 1–12 of 25 exact records');
  });

  it('shows owner, assistant boundary rows including unassigned and inactive or unknown', () => {
    render(<InsightsDashboard model={MODEL} />);
    const work = screen.getByRole('heading', { name: 'Follow-through, not activity theater' }).closest('section');
    expect(work).not.toBeNull();
    expect(within(work!).getByText('Unassigned')).toBeInTheDocument();
    expect(within(work!).getByText('Inactive / unknown')).toBeInTheDocument();
    expect(within(work!).getByText(/Revoked or unknown membership/)).toBeInTheDocument();
  });

  it('lets work status govern presentation and never turns missing evidence into zero', () => {
    render(<InsightsDashboard model={{ ...MODEL, work: { ...MODEL.work, status: 'insufficient-evidence', open: null, overdue: null, dueSoon: null, completed: null, previousCompleted: null, members: [] } }} />);
    const work = screen.getByRole('heading', { name: 'Follow-through, not activity theater' }).closest('section');
    expect(work).not.toBeNull();
    expect(within(work!).getByText(/Counts are withheld rather than shown as zero/)).toBeInTheDocument();
    expect(within(work!).queryByText('0')).not.toBeInTheDocument();
  });

  it('marks cap-affected metrics and their selected contributor list incomplete', () => {
    const incomplete = MODEL.drilldowns.map((item) => item.id === 'source-referral' ? { ...item, status: 'possibly-truncated' as const } : item);
    render(<InsightsDashboard model={{
      ...MODEL,
      sourceStatus: 'possibly-truncated',
      drilldowns: incomplete,
      coverage: { ...MODEL.coverage, transitionPossiblyTruncated: true },
    }} />);
    expect(screen.getAllByText(/Incomplete result/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Incomplete evidence set')).toBeInTheDocument();
    expect(screen.getByText(/affected metrics are incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/500-record per-type read boundary/)).toBeInTheDocument();
  });

  it('renders verified live finance and a linked deal intake path', () => {
    render(<InsightsDashboard model={MODEL} />);
    expect(screen.getByRole('heading', { name: 'The financial pulse of the business.' })).toBeInTheDocument();
    expect(screen.getAllByText('$425,000')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save verified transaction' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Contact' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('buyer');
  });

  it('withholds finance when the verified ledger read fails', () => {
    render(<InsightsDashboard model={{ ...MODEL, transactionStatus: 'insufficient-evidence', transactionMetrics: null, transactions: [] }} />);
    expect(screen.getByText(/Financial ledger needs its database update/)).toBeInTheDocument();
    expect(screen.queryByText('$425,000')).not.toBeInTheDocument();
  });
});
