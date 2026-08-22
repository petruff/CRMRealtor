/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertCenter } from '@/components/alert-center';
import {
  OMNIX_CITATION_SCHEMA_VERSION,
  type OmnixCopilotAlert,
  type OmnixCopilotAlertCategory,
  type OmnixCopilotAlertPriority,
  type OmnixCopilotCitation,
} from '@/lib/domain/omnix-copilot';

const AS_OF = '2026-08-13T14:00:00.000Z';

function makeAlert(
  index: number,
  category: OmnixCopilotAlertCategory,
  priority: OmnixCopilotAlertPriority,
  marker: string,
): OmnixCopilotAlert {
  const recordId = `mounted-${String(index).padStart(3, '0')}`;
  const source: OmnixCopilotCitation = {
    id: `citation-${recordId}`,
    schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
    entityType: 'contact',
    recordId,
    factKeys: ['nextTouchAt'],
    responseAsOf: AS_OF,
    target: `/contacts/${recordId}`,
    rule: category === 'celebration' ? 'birthday' : 'due-today-follow-up',
  };
  return {
    id: `alert:${marker}:${recordId}`,
    rule: category === 'celebration' ? 'birthday' : 'due-today-follow-up',
    category,
    priority,
    order: index,
    reason: `${marker} evidence ${recordId}`,
    asOf: AS_OF,
    recordId,
    href: `/contacts/${recordId}`,
    citations: [source],
  };
}

function fixture(): OmnixCopilotAlert[] {
  return [
    ...Array.from({ length: 25 }, (_, index) => makeAlert(index, index % 2 ? 'task' : 'follow-up', index % 2 ? 'high' : 'urgent', 'act-now')),
    ...Array.from({ length: 26 }, (_, offset) => makeAlert(25 + offset, offset % 2 ? 'task' : 'follow-up', offset % 3 ? 'normal' : 'low', 'coming-up')),
    ...Array.from({ length: 13 }, (_, offset) => makeAlert(51 + offset, 'celebration', offset % 2 ? 'normal' : 'low', 'relationship')),
    ...Array.from({ length: 24 }, (_, offset) => makeAlert(64 + offset, offset % 2 ? 'mailer' : 'pipeline', offset % 3 ? 'normal' : 'low', 'data-readiness')),
  ];
}

function renderCenter(alerts = fixture(), availability: 'available' | 'partial' | 'unavailable' = 'available', warnings: string[] = []) {
  return render(<AlertCenter
    alerts={alerts}
    citations={alerts.flatMap((alert) => alert.citations)}
    warnings={warnings}
    asOf={AS_OF}
    availability={availability}
    dataMode="live"
  />);
}

function cards(): HTMLElement[] {
  return screen.queryAllByRole('article');
}

function cardIds(): string[] {
  return cards().map((card) => card.closest('[data-alert-id]')?.getAttribute('data-alert-id') ?? '');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AlertCenter mounted progressive disclosure', () => {
  it('renders 88 canonical alerts with exact tiles, only Act now open, and a bounded default DOM', () => {
    renderCenter();

    const groupFilters = within(screen.getByLabelText('Alert group filters')).getAllByRole('button');
    expect(groupFilters.map((button) => button.textContent)).toEqual([
      'Act now25',
      'Coming up26',
      'Relationship moments13',
      'Data readiness24',
    ]);
    expect(screen.getByRole('button', { name: /Act now.*25 items/ })).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Coming up', 'Relationship moments', 'Data readiness']) {
      expect(screen.getByRole('button', { name: new RegExp(`${name}.*items`) })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(cards()).toHaveLength(12);
    expect(screen.getByRole('status')).toHaveTextContent('88 matching alerts. 12 shown across 1 open group.');
    for (const trigger of screen.getAllByRole('button', { name: /items/ })) {
      expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
    }
  });

  it('keeps Act now open when its canonical count is zero and mounts no closed-group cards', () => {
    const alerts = fixture().slice(25);
    renderCenter(alerts);

    expect(screen.getByRole('button', { name: /Act now.*0 items/ })).toHaveAttribute('aria-expanded', 'true');
    expect(cards()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent(`${alerts.length} matching alerts. 0 shown across 1 open group.`);
  });

  it('AND-composes search, group, category, and priority while OR-composing selections within a dimension', async () => {
    const user = userEvent.setup();
    renderCenter();

    await user.click(within(screen.getByLabelText('Alert group filters')).getByRole('button', { name: /Coming up/ }));
    await user.click(within(screen.getByRole('group', { name: 'Category filters' })).getByRole('button', { name: 'Task' }));
    await user.click(within(screen.getByRole('group', { name: 'Priority filters' })).getByRole('button', { name: 'Normal' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'COMING-UP');

    const expected = fixture().filter((alert) => alert.reason.includes('coming-up') && alert.category === 'task' && alert.priority === 'normal');
    expect(screen.getByRole('status')).toHaveTextContent(`${expected.length} matching alerts.`);
    expect(cards()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Coming up.*items/ }));
    expect(cardIds()).toEqual(expected.slice(0, 12).map((alert) => alert.id));

    await user.click(within(screen.getByRole('group', { name: 'Category filters' })).getByRole('button', { name: 'Follow-up' }));
    const withCategoryOr = fixture().filter((alert) => alert.reason.includes('coming-up') && ['task', 'follow-up'].includes(alert.category) && alert.priority === 'normal');
    expect(screen.getByRole('status')).toHaveTextContent(`${withCategoryOr.length} matching alerts.`);
    expect(screen.getByRole('button', { name: 'Task' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Follow-up' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps Expand all bounded, preserves per-group progress through disclosure, and resets batches on criteria changes', async () => {
    const user = userEvent.setup();
    renderCenter();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(cards()).toHaveLength(48);
    for (const groupName of ['Act now', 'Coming up', 'Relationship moments', 'Data readiness']) {
      const trigger = screen.getByRole('button', { name: new RegExp(`${groupName}.*items`) });
      const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
      expect(within(panel as HTMLElement).queryAllByRole('article').length).toBeLessThanOrEqual(12);
    }

    const actPanel = document.getElementById('alerts-act-now-panel') as HTMLElement;
    await user.click(within(actPanel).getByRole('button', { name: 'Show next 12 (13 remaining)' }));
    expect(within(actPanel).getAllByRole('article')).toHaveLength(24);
    await user.click(screen.getByRole('button', { name: /Act now.*25 items/ }));
    expect(within(actPanel).queryAllByRole('article')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Act now.*25 items/ }));
    expect(within(actPanel).getAllByRole('article')).toHaveLength(24);

    await user.click(screen.getByRole('button', { name: 'Urgent' }));
    expect(within(actPanel).getAllByRole('article')).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Urgent' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reaches every record in canonical group order with final partial batches and no duplicates', async () => {
    const user = userEvent.setup();
    const alerts = fixture();
    renderCenter(alerts);
    await user.click(screen.getByRole('button', { name: 'Expand all' }));

    for (const [groupId, expected] of [
      ['act-now', alerts.slice(0, 25)],
      ['coming-up', alerts.slice(25, 51)],
      ['relationship-moments', alerts.slice(51, 64)],
      ['data-readiness', alerts.slice(64, 88)],
    ] as const) {
      const panel = document.getElementById(`alerts-${groupId}-panel`) as HTMLElement;
      while (within(panel).queryByRole('button', { name: /Show next/ })) {
        await user.click(within(panel).getByRole('button', { name: /Show next/ }));
      }
      const ids = within(panel).getAllByRole('article').map((card) => card.closest('[data-alert-id]')?.getAttribute('data-alert-id'));
      expect(ids).toEqual(expected.map((alert) => alert.id));
      expect(new Set(ids).size).toBe(expected.length);
      expect(within(panel).getByText(`All ${expected.length} shown`)).toBeInTheDocument();
    }
    expect(cards()).toHaveLength(88);
    expect(screen.getByRole('status')).toHaveTextContent('All 88 matching alerts shown.');
  });

  it('clears criteria after filtered-zero and restores the canonical result with 12-item limits', async () => {
    const user = userEvent.setup();
    renderCenter();

    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'not in the catalog');
    expect(screen.getByText('No alerts match these filters')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 matching alerts. No alert cards shown.');
    const filteredZero = screen.getByText('No alerts match these filters').parentElement as HTMLElement;
    await user.click(within(filteredZero).getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toHaveValue('');
    expect(cards()).toHaveLength(12);
    expect(screen.queryByText('No alerts match these filters')).not.toBeInTheDocument();
  });

  it('distinguishes canonical zero, unavailable, and partial without mutation controls', () => {
    const { unmount } = renderCenter([]);
    expect(screen.getByText('You’re clear for now')).toBeInTheDocument();
    expect(screen.queryByText('No alerts match these filters')).not.toBeInTheDocument();
    unmount();

    renderCenter([], 'unavailable', ['private detail']);
    expect(screen.getByRole('alert')).toHaveTextContent('Alerts could not load');
    expect(screen.queryByText('private detail')).not.toBeInTheDocument();
    cleanup();

    renderCenter(fixture().slice(0, 3), 'partial', ['Some records were unavailable.']);
    expect(screen.getByRole('note', { name: 'Partial result' })).toHaveTextContent('counts are incomplete');
    expect(screen.getByText('Some records were unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss|snooze/i })).not.toBeInTheDocument();
  });
});
