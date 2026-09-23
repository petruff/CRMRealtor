/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortalLinkState } from '@/app/transactions/portal-actions';
import { ClientPortalShare } from './client-portal-share';

afterEach(cleanup);

describe('ClientPortalShare', () => {
  it('creates a link and shows it once with copy, text and email options', async () => {
    const url = `https://crm.example.com/portal/${'a'.repeat(43)}`;
    const action = vi.fn(async (): Promise<PortalLinkState> => ({ status: 'created', url }));
    render(<ClientPortalShare action={action} defaultAudience="Linh Nguyen" propertyAddress="1408 Bayshore Dr" />);
    expect(screen.getByLabelText('For')).toHaveValue('Linh Nguyen');
    await userEvent.click(screen.getByRole('button', { name: 'Create private link' }));

    expect(await screen.findByLabelText('Private client link')).toHaveValue(url);
    expect(screen.getByText(/can’t show it again/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Text it' })).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(url)));
    expect(screen.getByRole('link', { name: 'Email it' })).toHaveAttribute('href', expect.stringMatching(/^mailto:\?subject=/));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows validation errors from the server', async () => {
    const action = vi.fn(async (): Promise<PortalLinkState> => ({ status: 'error', message: 'Add who this link is for (up to 80 characters).' }));
    render(<ClientPortalShare action={action} defaultAudience="Linh" propertyAddress="1408 Bayshore Dr" />);
    await userEvent.click(screen.getByRole('button', { name: 'Create private link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add who this link is for');
  });
});
