/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeadPageState } from '@/app/l/[key]/actions';
import { LeadPageForm } from './lead-page-form';
import { LeadPageShare } from './lead-page-share';

afterEach(cleanup);

describe('LeadPageForm', () => {
  it('starts with consent unchecked and hides the honeypot', () => {
    render(<LeadPageForm action={vi.fn()} agentFirstName="Judith" source="instagram" />);
    expect(screen.getByRole('checkbox', { name: /text me/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /email me/i })).not.toBeChecked();
    expect(screen.getByText(/how can judith help/i)).toBeInTheDocument();
    expect(document.querySelector('input[name="src"]')).toHaveValue('instagram');
    expect(document.querySelector('input[name="company"]')).toHaveAttribute('tabindex', '-1');
  });

  it('submits and thanks the visitor by name', async () => {
    const action = vi.fn(async (_state: LeadPageState, data: FormData): Promise<LeadPageState> => ({ status: 'sent', firstName: String(data.get('firstName')) }));
    render(<LeadPageForm action={action} agentFirstName="Judith" />);
    await userEvent.type(screen.getByLabelText('First name'), 'Ana');
    await userEvent.type(screen.getByLabelText('Last name'), 'Silva');
    await userEvent.type(screen.getByLabelText(/email/i, { selector: 'input[type="email"]' }), 'ana@example.com');
    await userEvent.click(screen.getByRole('radio', { name: 'Buy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thanks, Ana!')).toBeInTheDocument();
    const sent = action.mock.calls[0]?.[1] as FormData;
    expect(sent.get('intent')).toBe('buyer');
    expect(sent.get('smsConsent')).toBeNull();
  });

  it('shows field errors and keeps typed values', async () => {
    const action = vi.fn(async (): Promise<LeadPageState> => ({
      status: 'error', message: 'Please check the highlighted fields.', fieldErrors: { phone: 'Use a 10-digit phone number.' }, values: { firstName: 'Ana', phone: '123' },
    }));
    render(<LeadPageForm action={action} agentFirstName="Judith" />);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check');
    expect(screen.getByLabelText(/mobile phone/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
  });
});

describe('LeadPageShare', () => {
  it('shows the link, share actions and a downloadable QR code', () => {
    render(<LeadPageShare url="https://omnix.test/l/lead-page-abc123def456" qrSvg="<svg></svg>" agentName="Judith Realty" />);
    expect(screen.getByLabelText('Your lead page link')).toHaveValue('https://omnix.test/l/lead-page-abc123def456');
    expect(screen.getByRole('link', { name: /download qr/i })).toHaveAttribute('download', 'omnix-lead-page-qr.svg');
    expect(screen.getByRole('link', { name: /text it/i }).getAttribute('href')).toContain(encodeURIComponent('https://omnix.test/l/lead-page-abc123def456'));
    expect(screen.getByRole('img', { name: /qr code/i })).toBeInTheDocument();
  });
});
