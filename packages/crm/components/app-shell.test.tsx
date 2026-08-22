/** @vitest-environment jsdom */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/contacts' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/components/brand-lockup', () => ({
  BrandLockup: () => <span>Omnix</span>,
  BrandMark: () => <span>O</span>,
  CyryxAttribution: () => <span>Cyryx</span>,
}));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button type="button">Theme</button> }));
vi.mock('@/components/crm-command-palette', () => ({ CrmCommandPalette: () => <button type="button">Search</button> }));
vi.mock('@/components/omnix-assistant-launcher', () => ({
  OmnixAssistantLauncher: ({ suppressed = false }: { suppressed?: boolean }) => (
    <div data-testid="assistant-launcher-contract" data-suppressed={String(suppressed)} />
  ),
}));

import { AppShell } from '@/components/app-shell';

describe('AppShell account controls', () => {
  afterEach(() => {
    cleanup();
    navigation.pathname = '/contacts';
  });

  it('exposes POST-only sign-out controls on desktop and mobile', () => {
    const html = renderToStaticMarkup(<AppShell><p>Content</p></AppShell>);

    expect(html.match(/action="\/auth\/signout"/g)).toHaveLength(1);
    expect(html.match(/method="post"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Sign out"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="More utilities"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('marks active destinations with semantic and non-color visual state', () => {
    const html = renderToStaticMarkup(<AppShell><p>Content</p></AppShell>);

    expect(html).toContain('href="/contacts" aria-current="page"');
    expect(html).toContain('sk-nav-link');
    expect(html).toContain('bg-accent-soft font-semibold text-accent');
    expect(html).toContain('sk-mobile-tab');
  });

  it('reveals every mobile utility, focuses the first action and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<AppShell><p>Content</p></AppShell>);

    const more = screen.getByRole('button', { name: 'More utilities' });
    expect(screen.getByTestId('assistant-launcher-contract')).toHaveAttribute('data-suppressed', 'false');
    await user.click(more);

    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('assistant-launcher-contract')).toHaveAttribute('data-suppressed', 'true');
    const utilities = screen.getByRole('navigation', { name: 'Mobile utilities' });
    expect(utilities).toBeInTheDocument();
    expect(utilities.querySelector('a[href="/alerts"]')).toHaveFocus();
    expect(utilities.querySelector('a[href="/settings"]')).toBeInTheDocument();
    expect(utilities.querySelector('a[href="/workspace"]')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Theme' })).toHaveLength(2);

    const signOut = utilities.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(signOut).not.toBeNull();
    expect(signOut!.closest('form')).toHaveAttribute('method', 'post');
    expect(signOut!.closest('form')).toHaveAttribute('action', '/auth/signout');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Mobile utilities' })).not.toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());
    expect(screen.getByTestId('assistant-launcher-contract')).toHaveAttribute('data-suppressed', 'false');
  });

  it('closes transient mobile utilities when the route changes', async () => {
    const user = userEvent.setup();
    const view = render(<AppShell><p>Content</p></AppShell>);
    await user.click(screen.getByRole('button', { name: 'More utilities' }));
    expect(screen.getByRole('navigation', { name: 'Mobile utilities' })).toBeInTheDocument();

    navigation.pathname = '/activities';
    view.rerender(<AppShell><p>Content</p></AppShell>);
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Mobile utilities' })).not.toBeInTheDocument());
  });
});
