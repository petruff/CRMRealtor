/** @vitest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadyItem } from '@/lib/application/ready-to-send';
import { ReadyToSend } from './ready-to-send';

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => { cleanup(); window.localStorage.clear(); });

const item = (id: string, extra: Partial<ReadyItem> = {}): ReadyItem => ({
  id: `follow-up:${id}`, contactId: id, name: `${id} Test`, firstName: id, initials: 'AT', leadType: 'warm', relationship: 'lead',
  kind: 'follow-up', reason: 'Follow-up 3 days overdue', phone: '3055550100', body: `Hi ${id}, checking in.`,
  href: `sms:3055550100?&body=${encodeURIComponent(`Hi ${id}, checking in.`)}`, ...extra,
});

describe('ReadyToSend', () => {
  it('opens Messages first, then logs the text only on Mark sent', async () => {
    const markSent = vi.fn(async () => ({ status: 'sent' as const }));
    render(<ReadyToSend items={[item('Ana', { hint: 'Prefers texts' })]} day="2026-09-24" markSent={markSent} />);
    expect(screen.getByText('Prefers texts')).toBeInTheDocument();
    const send = screen.getByRole('link', { name: /send in messages/i });
    expect(send).toHaveAttribute('href', 'sms:3055550100?&body=Hi%20Ana%2C%20checking%20in.');
    send.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(send);
    expect(markSent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /mark sent/i }));
    await waitFor(() => expect(markSent).toHaveBeenCalledWith('Ana', 'Hi Ana, checking in.'));
    expect(await screen.findByText(/All caught up — 1 sent today/u)).toBeInTheDocument();
  });

  it('sends the edited words and remembers skips for today on this device', async () => {
    const markSent = vi.fn(async () => ({ status: 'sent' as const }));
    const { unmount } = render(<ReadyToSend items={[item('Ana'), item('Ben')]} day="2026-09-24" markSent={markSent} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    const box = screen.getByRole('textbox', { name: 'Message to Ana Test' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Hey Ana!');
    expect(screen.getAllByRole('link', { name: /send in messages/i })[0]).toHaveAttribute('href', 'sms:3055550100?&body=Hey%20Ana!');
    await userEvent.click(screen.getByRole('button', { name: 'Skip Ben Test for today' }));
    expect(screen.queryByText('Ben Test')).not.toBeInTheDocument();
    unmount();
    render(<ReadyToSend items={[item('Ana'), item('Ben')]} day="2026-09-24" markSent={markSent} />);
    await waitFor(() => expect(screen.queryByText('Ben Test')).not.toBeInTheDocument());
    cleanup();
    render(<ReadyToSend items={[item('Ben')]} day="2026-09-25" markSent={markSent} />);
    expect(screen.getByText('Ben Test')).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to prepare', () => {
    const { container } = render(<ReadyToSend items={[]} day="2026-09-24" markSent={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
