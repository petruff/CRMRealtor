/** @vitest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceUpdate } from './voice-update';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
afterEach(cleanup);

const review = vi.fn(async (contactId: string, text: string) => ({
  status: 'ok' as const,
  review: {
    contactId, contactName: 'Ana Silva', note: text,
    changes: [
      { field: 'priceMax' as const, label: 'Budget up to', before: '$400k', after: '$450k', value: 450000, evidence: 'for 450k' },
      { field: 'beds' as const, label: 'Bedrooms', after: '3+', value: 3, evidence: '3 beds' },
    ],
  },
}));

describe('VoiceUpdate', () => {
  it('reviews what it understood and saves only what the realtor keeps', async () => {
    const apply = vi.fn(async () => ({ status: 'saved' as const, message: 'Ana Silva is up to date.' }));
    render(<VoiceUpdate contactId="c1" firstName="Ana" review={review} apply={apply} />);
    await userEvent.click(screen.getByRole('button', { name: /voice update/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /what happened with ana/i }), 'Pre-approved for 450k, wants 3 beds');
    await userEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(await screen.findByText(/Here’s what I’ll update for Ana/u)).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /bedrooms/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save update' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ contactId: 'c1', text: 'Pre-approved for 450k, wants 3 beds', keep: ['priceMax'], saveNote: true }));
    expect(await screen.findByText('Ana Silva is up to date.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });
});
