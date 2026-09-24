/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviveLeads } from './revive-leads';
import type { ReviveItem } from '@/lib/application/revive-leads';

afterEach(() => { cleanup(); window.localStorage.clear(); });

const item = (id: string): ReviveItem => ({
  contactId: id, name: `${id} Test`, firstName: id, initials: 'AT', leadType: 'warm', email: `${id.toLowerCase()}@example.com`, angle: 'seller',
  why: 'Seller lead · added 44 days ago, never contacted', subject: 'A quick question about 1450 Sunset Dr', body: 'Hi Ana,\n\nThis is Judith.',
});

function preventNavigation() {
  for (const link of screen.getAllByRole('link', { name: /Open in email/u })) link.addEventListener('click', (event) => event.preventDefault());
}

describe('ReviveLeads', () => {
  it('opens the email first, then logs it only on Mark sent', async () => {
    const markSent = vi.fn(async () => ({ status: 'done' as const }));
    render(<ReviveLeads items={[item('Ana')]} eligible={196} day="2026-09-24" markSent={markSent} stopEmails={vi.fn()} />);
    expect(screen.getByText(/196 old leads are waiting/u)).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /Open in email/u });
    expect(open.getAttribute('href')).toMatch(/^mailto:ana%40example\.com\?subject=A%20quick%20question/u);
    preventNavigation();
    expect(markSent).not.toHaveBeenCalled();
    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: /Mark sent/u }));
    expect(markSent).toHaveBeenCalledWith('Ana', 'A quick question about 1450 Sunset Dr');
    expect(await screen.findByRole('status')).toHaveTextContent('1 sent');
  });

  it('sends the edited subject', async () => {
    const markSent = vi.fn(async () => ({ status: 'done' as const }));
    render(<ReviveLeads items={[item('Ana')]} eligible={1} day="2026-09-24" markSent={markSent} stopEmails={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit/u }));
    const subject = screen.getByLabelText('Subject for Ana Test');
    await userEvent.clear(subject);
    await userEvent.type(subject, 'Hello Ana');
    expect(screen.getByRole('link', { name: /Open in email/u }).getAttribute('href')).toContain('subject=Hello%20Ana');
  });

  it('asks before turning email off, and remembers skips for the day', async () => {
    const stopEmails = vi.fn(async () => ({ status: 'done' as const }));
    render(<ReviveLeads items={[item('Ana'), item('Bo')]} eligible={2} day="2026-09-24" markSent={vi.fn()} stopEmails={stopEmails} />);
    await userEvent.click(screen.getAllByRole('button', { name: /Asked to stop/u })[0]!);
    expect(stopEmails).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, turn off' }));
    expect(stopEmails).toHaveBeenCalledWith('Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Skip Bo Test for today' }));
    expect(JSON.parse(window.localStorage.getItem('omnix-revive-skipped-2026-09-24') ?? '[]')).toEqual(['Ana', 'Bo']);
    expect(screen.getByRole('status')).toHaveTextContent('Done for today');
  });

  it('shows an empty state when nobody qualifies', () => {
    render(<ReviveLeads items={[]} eligible={0} day="2026-09-24" markSent={vi.fn()} stopEmails={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('No old leads to revive right now.');
  });
});
