// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { TodayQueueDisclosure } from '@/components/today-queue-disclosure';
import type { Contact } from '@/lib/domain/contact';
import type { TriageBucket } from '@/lib/domain/triage';

const contact: Contact = {
  id: 'contact-1', firstName: 'Judith', lastName: 'Serna', leadType: 'hot',
  relationship: 'lead', intent: 'seller', source: 'website', pipelineStage: 'new',
  tags: [], createdAt: '2026-08-12T13:00:00.000Z', nextTouchAt: '2026-08-12',
};

const buckets: readonly TriageBucket[] = [{
  id: 'needs-first-contact', title: 'Needs first contact', blurb: 'Act quickly',
  emptyMessage: 'Clear', tone: 'hot', entries: [{ contact, score: 10, reason: 'Never contacted', daysOverdue: 0 }],
}, {
  id: 'overdue', title: 'Overdue', blurb: 'Past due', emptyMessage: 'Clear', tone: 'warm', entries: [],
}, {
  id: 'due-today', title: 'Due today', blurb: 'Due today', emptyMessage: 'Clear', tone: 'accent', entries: [],
}, {
  id: 'celebrations', title: 'Celebrations', blurb: 'Moments', emptyMessage: 'Clear', tone: 'nurture', entries: [],
}, {
  id: 'coming-up', title: 'Coming up', blurb: 'Next seven days', emptyMessage: 'Clear', tone: 'neutral', entries: [],
}];

afterEach(cleanup);

describe('TodayQueueDisclosure', () => {
  it('keeps the queue unmounted until explicitly opened and deterministically resets after closing', async () => {
    const user = userEvent.setup();
    render(<TodayQueueDisclosure contacts={[contact]} buckets={buckets} />);

    const trigger = screen.getByRole('button', { name: /explore the complete work queue/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toHaveAttribute('hidden');
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.queryByText('Who needs your attention')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole('button', { name: /close the complete work queue/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    expect(screen.getByText('Who needs your attention')).toBeInTheDocument();
    expect(screen.getByText('Judith Serna')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close the complete work queue/i }));
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /explore the complete work queue/i }));
    expect(screen.getByRole('tab', { name: /Now · 1/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });
});
