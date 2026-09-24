/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListingStatusControl } from './listing-status';

afterEach(() => cleanup());

describe('ListingStatusControl', () => {
  it('marks a seller as listed and explains what changes', async () => {
    const save = vi.fn(async () => ({ status: 'saved' as const, message: 'Ana Silva’s listing is active.' }));
    render(<ListingStatusControl contactId="c1" stage="new" save={save} />);
    await userEvent.click(screen.getByRole('button', { name: 'Mark as listing' }));
    expect(screen.getByText(/weekly update for this seller will be ready every Friday/u)).toHaveTextContent('The deal stage also moves to Active.');
    await userEvent.type(screen.getByLabelText('Home being sold'), '123 Palm Ave');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('c1', 'Active', '123 Palm Ave');
    expect(await screen.findByRole('status')).toHaveTextContent('listing is active');
  });

  it('prefills the current status, keeps the form open on errors, and cancels cleanly', async () => {
    const save = vi.fn(async () => ({ status: 'error' as const, message: 'Add the address of the home being sold.' }));
    render(<ListingStatusControl contactId="c1" stage="active" currentStatus="Pending" currentAddress="9 Bay Rd" save={save} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change listing status' }));
    expect(screen.getByLabelText('Listing status')).toHaveValue('Pending');
    await userEvent.selectOptions(screen.getByLabelText('Listing status'), 'Sold');
    expect(screen.getByText(/Weekly seller updates stop/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the address');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Change listing status' })).toBeInTheDocument();
  });
});
