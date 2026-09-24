/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListingWriter } from './listing-writer';
import type { ListingWriterState } from '@/app/listing-writer/actions';

afterEach(() => cleanup());

describe('ListingWriter', () => {
  it('prefills property facts and shows the written copy with share actions', async () => {
    const action = vi.fn(async (_state: ListingWriterState, formData: FormData): Promise<ListingWriterState> => ({
      status: 'written', format: String(formData.get('format')), language: String(formData.get('language')), text: 'Subject: Just listed in Doral\n\nHi there', source: 'template', findings: [], note: 'Built-in template',
    }));
    render(<ListingWriter action={action} prefill={{ city: 'Doral', beds: 4, price: 725000 }} agentName="Judith" />);
    expect(screen.getByDisplayValue('Doral')).toBeInTheDocument();
    expect(screen.getByDisplayValue('725000')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Highlights/u), { target: { value: 'heated pool' } });
    await userEvent.click(screen.getByRole('button', { name: 'Email blast' }));
    await waitFor(() => expect(screen.getByLabelText('Email blast copy')).toHaveValue('Subject: Just listed in Doral\n\nHi there'));
    expect(screen.getByDisplayValue('Doral')).toBeInTheDocument();
    expect(screen.getByLabelText(/Highlights/u)).toHaveValue('heated pool');
    const sent = action.mock.calls[0]![1];
    expect(sent.get('agentName')).toBe('Judith');
    expect(sent.get('format')).toBe('email');
    expect(screen.getByRole('link', { name: /Open in email/u }).getAttribute('href')).toContain('subject=Just%20listed%20in%20Doral');
    expect(screen.getByText(/Fair Housing check passed/u)).toBeInTheDocument();
  });

  it('shows Fair Housing findings returned by the server', async () => {
    const action = vi.fn(async (): Promise<ListingWriterState> => ({
      status: 'error', message: 'Some words describe who should live there instead of the home. Rephrase them before writing.',
      findings: [{ index: 0, phrase: 'perfect for families', category: 'familial-status', severity: 'avoid', suggestion: 'Describe the space instead.' }] as never,
    }));
    render(<ListingWriter action={action} />);
    fireEvent.change(screen.getByLabelText(/City or neighborhood/u), { target: { value: 'Doral' } });
    fireEvent.change(screen.getByLabelText(/Highlights/u), { target: { value: 'perfect for families' } });
    await userEvent.click(screen.getByRole('button', { name: 'MLS description' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('perfect for families');
  });
});
