/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OmnixCopilotUiResult } from '@/components/omnix-copilot-view-model';
import { OmnixAssistantLauncher } from '@/components/omnix-assistant-launcher';

const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('@/app/omnix/actions', () => ({
  askOmnixCopilotAction: vi.fn(),
  getOmnixAssistantProfileAction: vi.fn(),
}));

const response: OmnixCopilotUiResult = {
  status: 'success',
  question: 'What should I do today?',
  intent: 'brief',
  dataMode: 'live',
  asOf: '2026-08-14T12:00:00.000Z',
  answerBlocks: [{
    id: 'brief', kind: 'summary', title: 'Today', detail: 'Two people need attention.',
    items: [], citationIds: [],
  }],
  citations: [], suggestions: [], alerts: [], warnings: [],
};

const responseWithSource: OmnixCopilotUiResult = {
  ...response,
  citations: [{
    id: 'contact-source',
    entityType: 'contact',
    recordId: '5cfc13f8-844c-4f4c-a992-f02c060939c8',
    factKeys: ['pipelineStage', 'lastContactedAt', 'createdAt', 'leadType', 'source'],
    sourceTimestamp: '2026-08-20T17:54:45.764Z',
    asOf: '2026-08-21T16:00:00.000Z',
    target: '/contacts/5cfc13f8-844c-4f4c-a992-f02c060939c8',
    rule: 'needs-first-contact',
    displayLabel: 'Alicia Morgan',
  }],
};

const webResearchResponse: OmnixCopilotUiResult = {
  status: 'success',
  question: 'Research Florida market trends',
  intent: 'web-research',
  asOf: '2026-09-01T20:00:00.000Z',
  answerBlocks: [{
    id: 'web-research-answer', kind: 'summary', title: 'Research answer',
    detail: 'Current conditions vary by local market.', items: [], citationIds: ['web-source-1'],
  }],
  citations: [{
    id: 'web-source-1', entityType: 'web', recordId: 'web-source-1', factKeys: ['public web source'],
    asOf: '2026-09-01T20:00:00.000Z', target: 'https://www.floridarealtors.org/research', displayLabel: 'Florida Realtors Research',
  }],
  suggestions: [], alerts: [], warnings: [],
  model: {
    state: 'available', provider: 'google-gemini', model: 'gemini-3.5-flash-lite',
    routed: false, narrated: false, researched: true, policyVersion: 'omnix-ai-policy.v1',
  },
};

describe('OmnixAssistantLauncher', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    navigation.pathname = '/';
  });

  it('opens an accessible personalized dialog and returns focus on Escape', async () => {
    const user = userEvent.setup();
    const launcher = render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(response)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    const open = screen.getByRole('button', { name: 'Open Omnix assistant' });
    await user.click(open);
    expect(await screen.findByRole('dialog', { name: 'Omnix AI' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: "Hi Judith, I'm Omnix" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask Omnix about the CRM or research a topic' })).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(open).toHaveFocus());
    launcher.unmount();
  });

  it('uses the injected authorized action and renders its grounded response', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue(response);
    render(<OmnixAssistantLauncher
      action={action}
      loadProfile={vi.fn().mockResolvedValue({ available: true, dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    await user.click(await screen.findByRole('button', { name: 'What should I do today?' }));

    await waitFor(() => expect(action).toHaveBeenCalledWith('What should I do today?'));
    expect(await screen.findByText('Two people need attention.')).toBeInTheDocument();
    expect(screen.getByText('Live CRM')).toBeInTheDocument();
  });

  it('presents CRM evidence without exposing database language to the member', async () => {
    const user = userEvent.setup();
    render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(responseWithSource)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    await user.click(await screen.findByRole('button', { name: 'What should I do today?' }));
    await user.click(await screen.findByText('View source (1)'));

    expect(await screen.findByText('Alicia Morgan')).toBeInTheDocument();
    expect(screen.getByText(/Based on pipeline stage, last contact, date added, lead temperature, and lead source/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Alicia Morgan/i })).toHaveAttribute(
      'href',
      '/contacts/5cfc13f8-844c-4f4c-a992-f02c060939c8',
    );
    expect(screen.queryByText(/5cfc13f8-844c-4f4c-a992-f02c060939c8/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipelineStage|lastContactedAt|createdAt|leadType/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-08-20T17:54:45.764Z/)).not.toBeInTheDocument();
  });

  it('distinguishes grounded web research and opens public sources safely', async () => {
    const user = userEvent.setup();
    render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(webResearchResponse)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    await user.type(await screen.findByRole('textbox', { name: 'Ask Omnix about the CRM or research a topic' }), 'Research Florida market trends');
    await user.click(screen.getByRole('button', { name: 'Ask Omnix' }));

    expect(await screen.findByText('Web researched')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Florida Realtors Research' });
    expect(link).toHaveAttribute('href', 'https://www.floridarealtors.org/research');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.queryByText('Live CRM')).not.toBeInTheDocument();
  });

  it('renders who needs attention as a bounded people-first decision brief', async () => {
    const user = userEvent.setup();
    const attentionItems = Array.from({ length: 8 }, (_, index) => ({
      id: `alert:overdue-follow-up:contact-${index + 1}:2026-08-23`,
      label: `Client ${index + 1} Morgan`,
      detail: '1 day overdue · Active client · Actively working · Referral',
      value: index === 0 ? 'Hot' : 'Warm',
      href: `/contacts/contact-${index + 1}`,
      citationIds: [],
    }));
    const attentionResponse: OmnixCopilotUiResult = {
      ...response,
      question: 'Who needs attention?',
      intent: 'alerts',
      answerBlocks: [
        {
          id: 'attention-summary',
          kind: 'metric',
          title: '8 attention items',
          detail: '8 people and 0 tasks need review. Start with Act now.',
          items: [
            { id: 'attention-people-count', label: 'People', value: 8, citationIds: [] },
            { id: 'attention-overdue-count', label: 'Act now', value: 8, citationIds: [] },
          ],
          citationIds: [],
        },
        {
          id: 'attention-overdue',
          kind: 'list',
          title: 'Act now',
          detail: 'Start with overdue follow-up and first-contact work.',
          items: attentionItems,
          citationIds: [],
        },
      ],
    };

    render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(attentionResponse)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    await user.click(await screen.findByRole('button', { name: 'Who needs attention?' }));

    expect(await screen.findByText('Omnix · Attention brief')).toBeInTheDocument();
    expect(screen.getByText('8 people and 0 tasks need review. Start with Act now.')).toBeInTheDocument();
    expect(screen.getByText('Client 1 Morgan')).toBeInTheDocument();
    expect(screen.getByText('Client 6 Morgan')).toBeInTheDocument();
    expect(screen.queryByText('Client 7 Morgan')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Client 1 Morgan' })).toHaveAttribute(
      'href',
      '/contacts/contact-1',
    );
    expect(screen.queryByText(/overdue-follow-up|Review source|Contact record 1/)).not.toBeInTheDocument();
    expect(screen.getByText('Showing 6 of 8 attention items')).toBeInTheDocument();

    const reveal = screen.getByRole('button', { name: 'Show next 2' });
    reveal.focus();
    await user.click(reveal);
    expect(screen.getByText('Client 7 Morgan')).toBeInTheDocument();
    expect(screen.getByText('Client 8 Morgan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All attention items shown' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'All attention items shown' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps large source sets calm and progressively reveals every citation', async () => {
    const user = userEvent.setup();
    const manySources: OmnixCopilotUiResult = {
      ...responseWithSource,
      citations: Array.from({ length: 20 }, (_, index) => ({
        ...responseWithSource.citations[0]!,
        id: `contact-source-${index}`,
        recordId: `contact-${index}`,
        target: `/contacts/contact-${index}`,
      })),
      answerBlocks: [{
        ...response.answerBlocks[0]!,
        citationIds: Array.from({ length: 20 }, (_, index) => `contact-source-${index}`),
      }],
    };
    render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(manySources)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    await user.click(await screen.findByRole('button', { name: 'What should I do today?' }));
    expect(await screen.findByText('+17 more in the source list')).toBeInTheDocument();

    await user.click(screen.getByText('View sources (20)'));
    const sourceList = screen.getByRole('list', { name: 'Answer sources' });
    expect(within(sourceList).getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByText('Showing 12 of 20')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 8 more' }));
    expect(within(sourceList).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByText('All 20 sources shown')).toBeInTheDocument();
  });

  it('keeps large CRM result collections bounded until the member asks for more', async () => {
    const user = userEvent.setup();
    const largeResponse: OmnixCopilotUiResult = {
      ...response,
      answerBlocks: [{
        id: 'mailer-history',
        kind: 'list',
        title: 'Mailer history',
        detail: 'Recent printed mailers recorded in the CRM.',
        items: Array.from({ length: 14 }, (_, index) => ({
          id: `mailer-${index + 1}`,
          label: `Mailer ${index + 1}`,
          citationIds: [],
        })),
        citationIds: [],
      }],
      alerts: Array.from({ length: 14 }, (_, index) => ({
        id: `alert-${index + 1}`,
        category: 'upcoming-follow-up',
        priority: 'planned',
        reason: `Follow-up ${index + 1}`,
        recordId: `contact-${index + 1}`,
        href: `/contacts/contact-${index + 1}`,
        citationIds: [],
      })),
    };

    render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(largeResponse)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    await user.click(await screen.findByRole('button', { name: 'What should I do today?' }));

    expect(await screen.findByText('Mailer 6')).toBeInTheDocument();
    expect(screen.queryByText('Mailer 7')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 6 of 14')).toBeInTheDocument();
    expect(screen.getByText('Follow-up 6')).toBeInTheDocument();
    expect(screen.queryByText('Follow-up 7')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 6 of 14 alerts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show next 6' }));
    expect(screen.getByText('Mailer 12')).toBeInTheDocument();
    expect(screen.queryByText('Mailer 13')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show next 6 alerts' }));
    expect(screen.getByText('Follow-up 12')).toBeInTheDocument();
    expect(screen.queryByText('Follow-up 13')).not.toBeInTheDocument();
  });

  it('contains page scrolling and exposes keyboard and latest-message navigation', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    document.body.style.overflow = 'clip';

    const launcher = render(<OmnixAssistantLauncher
      action={vi.fn().mockResolvedValue(response)}
      loadProfile={vi.fn().mockResolvedValue({ available: true, firstName: 'Judith', dataMode: 'live' })}
    />);

    await user.click(screen.getByRole('button', { name: 'Open Omnix assistant' }));
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.queryByRole('log', { name: 'Omnix conversation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'What should I do today?' }));
    const activeConversation = await screen.findByRole('log', { name: 'Omnix conversation' });
    expect(activeConversation).toHaveClass('omnix-conversation-scroll', 'overflow-y-auto', 'overscroll-contain');
    expect(activeConversation).toHaveAttribute('tabindex', '0');

    const jump = await screen.findByRole('button', { name: 'Jump to latest message' });
    expect(jump).toHaveAttribute('aria-controls', activeConversation.id);
    scrollIntoView.mockClear();
    await user.click(jump);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('clip');
    launcher.unmount();
  });

  it('keeps the dialog bounded and provides visible cross-browser scrollbar styling', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.omnix-assistant-dialog\s*{[^}]*height:\s*min\(88dvh,\s*52rem\)/s);
    expect(css).toMatch(/\.omnix-conversation-scroll\s*{[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;/s);
    expect(css).toMatch(/\.omnix-conversation-scroll::-webkit-scrollbar-thumb\s*{[^}]*background:\s*var\(--sk-control-border-color\);/s);
    expect(css).toMatch(/\.omnix-assistant-dialog \.omnix-copilot-composer\s*{[^}]*safe-area-inset-bottom/s);
  });

  it('removes the floating launcher from mobile content and preserves the desktop avatar', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.omnix-assistant-launcher\s*{[^}]*display:\s*none;/s);
    expect(css).toMatch(/@media \(max-width:\s*63\.999rem\)[\s\S]*\.omnix-assistant-label\s*{[^}]*clip-path:\s*inset\(50%\)/s);
    expect(css).toMatch(/@media \(min-width:\s*64rem\)[\s\S]*\.omnix-assistant-launcher\s*{[^}]*display:\s*grid;[^}]*width:\s*5\.25rem;[^}]*height:\s*5\.25rem;/s);
  });

  it('suppresses the closed launcher while a competing shell disclosure is open', () => {
    const view = render(<OmnixAssistantLauncher suppressed />);
    expect(screen.queryByRole('button', { name: 'Open Omnix assistant' })).not.toBeInTheDocument();

    view.rerender(<OmnixAssistantLauncher />);
    expect(screen.getByRole('button', { name: 'Open Omnix assistant' })).toBeInTheDocument();
  });

  it('does not mount a duplicate launcher on the dedicated Omnix route', () => {
    navigation.pathname = '/omnix';
    render(<OmnixAssistantLauncher />);
    expect(screen.queryByRole('button', { name: 'Open Omnix assistant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
