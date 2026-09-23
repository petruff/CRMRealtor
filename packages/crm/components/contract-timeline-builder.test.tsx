/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineState } from '@/app/transactions/timeline-actions';
import { ContractTimelineBuilder } from './contract-timeline-builder';

afterEach(cleanup);

describe('ContractTimelineBuilder', () => {
  it('previews every deadline and only saves after confirmation', async () => {
    const action = vi.fn(async (_state: TimelineState, form: FormData): Promise<TimelineState> =>
      form.get('confirmed') === 'on' ? { status: 'saved', message: '5 dates added to this deal.' } : { status: 'error', message: 'Check each date against the signed contract, then confirm.' });
    render(<ContractTimelineBuilder action={action} today="2026-09-23" defaultClosingDate="2026-10-30" />);

    const preview = screen.getByRole('list', { name: 'Dates to be added' });
    expect(within(preview).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Initial escrow deposit dueMon, Sep 28moved past a weekend or holiday',
      'Loan application dueMon, Sep 28',
      'Inspection period endsThu, Oct 8',
      'Loan approval period endsFri, Oct 23',
      'ClosingFri, Oct 30',
    ]);

    await userEvent.click(screen.getByLabelText('Cash'));
    expect(within(screen.getByRole('list', { name: 'Dates to be added' })).queryByText('Loan application due')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add these dates to the deal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('confirm');

    await userEvent.click(screen.getByRole('checkbox', { name: /These periods match the signed contract/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add these dates to the deal' }));
    expect(await screen.findByRole('status')).toHaveTextContent('5 dates added');
  });
});
