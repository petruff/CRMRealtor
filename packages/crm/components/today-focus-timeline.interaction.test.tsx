// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayFocusTimeline } from '@/components/today-focus-timeline';
import {
  OMNIX_CITATION_SCHEMA_VERSION,
  type OmnixCopilotAlert,
  type OmnixCopilotCitation,
} from '@/lib/domain/omnix-copilot';

const AS_OF = '2026-08-12T14:00:00.000Z';

function alert(index: number): OmnixCopilotAlert {
  const citation: OmnixCopilotCitation = {
    id: `citation-${index}`,
    schemaVersion: OMNIX_CITATION_SCHEMA_VERSION,
    entityType: 'contact',
    recordId: `contact-${index}`,
    factKeys: ['nextTouchAt'],
    responseAsOf: AS_OF,
    target: `/contacts/contact-${index}`,
    rule: 'due-today-follow-up',
  };
  return {
    id: `alert-${index}`,
    rule: 'due-today-follow-up',
    category: 'follow-up',
    priority: 'high',
    order: index,
    reason: `Priority ${index}`,
    asOf: AS_OF,
    recordId: `contact-${index}`,
    href: `/contacts/contact-${index}`,
    citations: [citation],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TodayFocusTimeline stable focus', () => {
  it('keeps the chosen priority stable and does not expose automatic-motion controls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const alerts = [alert(1), alert(2)];

    render(<TodayFocusTimeline
      alerts={alerts}
      citations={alerts.flatMap((item) => item.citations)}
      warnings={[]}
      asOf={AS_OF}
      formattedAsOf="Aug 12, 10:00 AM"
      availability="available"
      dataMode="live"
    />);

    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Pause focus' })).not.toBeInTheDocument();
    expect(screen.getByText('Priority 1', { selector: 'h3' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByText('Priority 1', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Priority 1/ })).toHaveAttribute('aria-current', 'step');
  });
});
