/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenHouseSignInState } from '@/app/open-house/kiosk/actions';
import { KIOSK_PIN_KEY, OpenHouseKiosk } from './open-house-kiosk';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(() => { cleanup(); router.push.mockReset(); sessionStorage.clear(); vi.useRealTimers(); });

describe('OpenHouseKiosk', () => {
  it('shows consent unchecked by default and thanks the guest after sign-in', async () => {
    const action = vi.fn(async (): Promise<OpenHouseSignInState> => ({ status: 'success', firstName: 'Ana', submissionKey: 'k1' }));
    render(<OpenHouseKiosk property="1408 Bayshore Dr" hostName="Paula" action={action} />);

    expect(screen.getByRole('checkbox', { name: /text me/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /email me/i })).not.toBeChecked();
    await userEvent.type(screen.getByLabelText('First name'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Thanks, Ana!' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next guest/i }));
    expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  });

  it('returns to a fresh form automatically after the countdown', async () => {
    const action = vi.fn(async (): Promise<OpenHouseSignInState> => ({ status: 'success', firstName: 'Ana', submissionKey: 'k2' }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<OpenHouseKiosk property="1408 Bayshore Dr" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Thanks, Ana!' });
    for (let second = 0; second < 9; second += 1) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  });

  it('shows field errors returned by the server', async () => {
    const action = vi.fn(async (): Promise<OpenHouseSignInState> => ({
      status: 'error', message: 'Please check the highlighted fields.', fieldErrors: { email: 'That email doesn’t look right.' }, values: { email: 'bad' },
    }));
    render(<OpenHouseKiosk property="1408 Bayshore Dr" action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please check the highlighted fields.');
    expect(screen.getByRole('textbox', { name: /^email/i })).toHaveAttribute('aria-invalid', 'true');
  });

  it('requires the staff PIN to leave the kiosk', async () => {
    sessionStorage.setItem(KIOSK_PIN_KEY, '2468');
    render(<OpenHouseKiosk property="1408 Bayshore Dr" action={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /staff/i }));
    const pin = screen.getByLabelText('Staff PIN to exit');
    await userEvent.type(pin, '1111');
    await userEvent.click(screen.getByRole('button', { name: 'Exit sign-in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('That PIN doesn’t match.');
    expect(router.push).not.toHaveBeenCalled();

    await userEvent.clear(pin);
    await userEvent.type(pin, '2468');
    await userEvent.click(screen.getByRole('button', { name: 'Exit sign-in' }));
    expect(router.push).toHaveBeenCalledWith('/open-house');
    expect(sessionStorage.getItem(KIOSK_PIN_KEY)).toBeNull();
  });
});
