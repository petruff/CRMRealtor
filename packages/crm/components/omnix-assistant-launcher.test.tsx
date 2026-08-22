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
  }],
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
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Ask Omnix a supported question' })).toHaveFocus());

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

    expect(await screen.findByText('Contact record')).toBeInTheDocument();
    expect(screen.getByText(/Based on pipeline stage, last contact, date added, lead temperature, and lead source/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open contact/i })).toHaveAttribute(
      'href',
      '/contacts/5cfc13f8-844c-4f4c-a992-f02c060939c8',
    );
    expect(screen.queryByText(/5cfc13f8-844c-4f4c-a992-f02c060939c8/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipelineStage|lastContactedAt|createdAt|leadType/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-08-20T17:54:45.764Z/)).not.toBeInTheDocument();
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

  it('uses a collision-safe 56px phone launcher while preserving the desktop avatar', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.omnix-assistant-launcher\s*{[^}]*width:\s*3\.5rem;[^}]*height:\s*3\.5rem;/s);
    expect(css).toMatch(/@media \(max-width:\s*63\.999rem\)[\s\S]*\.omnix-assistant-label\s*{[^}]*clip-path:\s*inset\(50%\)/s);
    expect(css).toMatch(/@media \(min-width:\s*64rem\)[\s\S]*\.omnix-assistant-launcher\s*{[^}]*width:\s*5\.25rem;[^}]*height:\s*5\.25rem;/s);
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
