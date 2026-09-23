/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WHATS_NEW_KEY, WhatsNew } from './whats-new';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(() => { cleanup(); localStorage.clear(); });

describe('WhatsNew', () => {
  it('shows once and stays dismissed in this browser', async () => {
    const { unmount } = render(<WhatsNew />);
    expect(await screen.findByRole('heading', { name: 'A few time-savers were just added' })).toBeInTheDocument();
    expect(screen.getByText(/You can turn this off/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('heading', { name: 'A few time-savers were just added' })).not.toBeInTheDocument();
    expect(localStorage.getItem(WHATS_NEW_KEY)).toBe('seen');
    unmount();
    render(<WhatsNew />);
    expect(screen.queryByRole('heading', { name: 'A few time-savers were just added' })).not.toBeInTheDocument();
  });

  it('links to the new tools and dismisses from the close button', async () => {
    render(<WhatsNew />);
    expect(await screen.findByRole('link', { name: 'Alerts you choose' })).toHaveAttribute('href', '/settings#morning-brief');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss what’s new' }));
    expect(localStorage.getItem(WHATS_NEW_KEY)).toBe('seen');
  });
});
