/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrmCommandPalette } from '@/components/crm-command-palette';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/app/search/actions', () => ({
  searchCrmAction: vi.fn(),
  resolveCrmCommandAction: vi.fn(),
}));

describe('CrmCommandPalette', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
    navigation.push.mockReset();
  });

  it('portals the dialog above shell stacking contexts and restores focus', async () => {
    const user = userEvent.setup();
    const view = render(<aside data-testid="sticky-rail"><CrmCommandPalette /></aside>);
    const trigger = screen.getByRole('button', { name: 'Open global search and commands' });

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Search and act' });
    expect(view.getByTestId('sticky-rail').contains(dialog)).toBe(false);
    expect(dialog.parentElement).toHaveClass('z-[100]');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('textbox', { name: 'Search Omnix' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps keyboard focus inside the open search dialog', async () => {
    const user = userEvent.setup();
    render(<CrmCommandPalette />);
    await user.click(screen.getByRole('button', { name: 'Open global search and commands' }));
    const dialog = await screen.findByRole('dialog', { name: 'Search and act' });
    const close = screen.getByRole('button', { name: 'Close search' });
    close.focus();
    await user.keyboard('{Tab}');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
