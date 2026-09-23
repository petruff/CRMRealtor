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
vi.mock('@/components/pwa-provider', () => ({ PwaInstallAction: () => <button type="button">Install Omnix</button> }));
const badge = vi.hoisted(() => ({ value: { total: 3, urgent: 1 } as { total: number; urgent: number } | undefined }));
vi.mock('@/app/inbox/actions', () => ({ inboxBadgeAction: vi.fn(async () => badge.value) }));

import { AppShell } from '@/components/app-shell';

describe('AppShell premium navigation', () => {
  afterEach(() => {
    cleanup();
    navigation.pathname = '/contacts';
    badge.value = { total: 3, urgent: 1 };
  });

  it('exposes POST-only sign-out controls', () => {
    const html = renderToStaticMarkup(<AppShell><p>Content</p></AppShell>);
    expect(html.match(/action="\/auth\/signout"/g)).toHaveLength(1);
    expect(html.match(/method="post"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Sign out"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="More utilities"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('shows five hubs on desktop and marks the owning hub with semantic and non-color state', () => {
    navigation.pathname = '/contacts/c-1';
    render(<AppShell><p>Content</p></AppShell>);
    const primary = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    const labels = Array.from(primary.querySelectorAll(':scope > div:first-child > a')).map((link) => link.textContent?.replace(/\d+$/, '').trim());
    expect(labels).toEqual(['Today', 'People', 'Deals', 'Inbox', 'Omnix']);
    const people = primary.querySelector('a[href="/contacts"]');
    expect(people).toHaveAttribute('aria-current', 'page');
    expect(people?.className).toContain('sk-nav-link');
    expect(people?.className).toContain('bg-accent-soft font-semibold text-accent');
  });

  it('keeps every secondary destination one click away under More', async () => {
    const user = userEvent.setup();
    render(<AppShell><p>Content</p></AppShell>);
    const toggle = screen.getByRole('button', { name: 'More' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const more = document.getElementById('rail-more')!;
    for (const href of ['/nurture', '/campaigns', '/mailers', '/insights', '/connections', '/data', '/settings', '/workspace']) {
      expect(more.querySelector(`a[href="${href}"]`), href).toBeInTheDocument();
    }
  });

  it('opens More automatically when the current page lives there', () => {
    navigation.pathname = '/settings';
    render(<AppShell><p>Content</p></AppShell>);
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('#rail-more a[href="/settings"]')).toHaveAttribute('aria-current', 'page');
  });

  it('shows sibling tabs inside a hub with the most specific tab selected', () => {
    navigation.pathname = '/transactions';
    render(<AppShell><p>Content</p></AppShell>);
    const tabs = screen.getByRole('navigation', { name: 'Deals sections' });
    expect(tabs.querySelector('a[href="/transactions"]')).toHaveAttribute('aria-current', 'page');
    expect(tabs.querySelector('a[href="/pipeline"]')).not.toHaveAttribute('aria-current');
    expect(tabs.querySelector('a[href="/properties"]')).toBeInTheDocument();
  });

  it('shows the Inbox waiting count and urgency, and nothing when the count is unknown or zero', async () => {
    render(<AppShell><p>Content</p></AppShell>);
    expect(await screen.findAllByLabelText('3 waiting, 1 urgent')).not.toHaveLength(0);
    cleanup();
    badge.value = undefined;
    render(<AppShell><p>Content</p></AppShell>);
    await waitFor(() => expect(screen.queryByLabelText(/waiting/)).not.toBeInTheDocument());
  });

  it('builds the phone tab bar around a raised quick-capture action', async () => {
    const user = userEvent.setup();
    render(<AppShell><p>Content</p></AppShell>);
    const tabBar = screen.getAllByRole('navigation', { name: 'Primary' })[1]!;
    expect(Array.from(tabBar.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(['/', '/contacts', '/inbox', '/omnix']);
    const capture = screen.getByRole('button', { name: 'Quick capture' });
    await user.click(capture);
    const dialog = screen.getByRole('dialog', { name: 'What just happened?' });
    expect(dialog.querySelector('a[href="/capture"]')).toHaveFocus();
    expect(dialog.querySelector('a[href="/contacts/new"]')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-launcher-contract')).toHaveAttribute('data-suppressed', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(capture).toHaveFocus());
  });

  it('traps focus inside quick capture', async () => {
    const user = userEvent.setup();
    render(<AppShell><p>Content</p></AppShell>);
    await user.click(screen.getByRole('button', { name: 'New' }));
    const dialog = screen.getByRole('dialog');
    const close = screen.getByRole('button', { name: 'Close quick capture' });
    close.focus();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('reveals phone utilities including Deals, focuses the first action and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<AppShell><p>Content</p></AppShell>);
    const more = screen.getByRole('button', { name: 'More utilities' });
    await user.click(more);
    const utilities = screen.getByRole('navigation', { name: 'Mobile utilities' });
    expect(utilities.querySelector('a[href="/pipeline"]')).toHaveFocus();
    for (const href of ['/transactions', '/properties', '/insights', '/campaigns', '/mailers', '/connections', '/data', '/settings', '/workspace']) {
      expect(utilities.querySelector(`a[href="${href}"]`), href).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Install Omnix' })).toBeInTheDocument();
    const signOut = Array.from(utilities.querySelectorAll('button')).find((button) => button.textContent?.includes('Sign out'));
    expect(signOut?.closest('form')).toHaveAttribute('action', '/auth/signout');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Mobile utilities' })).not.toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());
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

  it('provides a deterministic mobile return action and a precise nested-route title', () => {
    navigation.pathname = '/contacts/contact-1/edit';
    const html = renderToStaticMarkup(<AppShell><p>Content</p></AppShell>);
    expect(html).toContain('href="/contacts/contact-1"');
    expect(html).toContain('aria-label="Back to Contact"');
    expect(html).toContain('Edit contact');
    expect(html).not.toContain('aria-label="People sections"');
  });

  it('does not invent a return action for an independent hub', () => {
    navigation.pathname = '/omnix';
    const html = renderToStaticMarkup(<AppShell><p>Content</p></AppShell>);
    expect(html).not.toContain('aria-label="Back to');
    expect(html).toContain('Omnix');
  });
});
