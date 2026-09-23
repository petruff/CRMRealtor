/** @vitest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallLogState } from '@/app/calls/actions';
import { CALL_PROMPT_PREFERENCE_KEY } from '@/lib/application/call-outcome';
import { CallFollowUp } from './call-follow-up';

vi.mock('@/components/voice-dictation', () => ({ VoiceDictation: () => null }));

function Page({ action }: { action: (id: string, state: CallLogState, form: FormData) => Promise<CallLogState> }) {
  return (
    <>
      <a href="tel:8135550142" data-call-contact="c-ana" data-call-name="Ana Cruz" onClick={(event) => event.preventDefault()}>Call</a>
      <CallFollowUp action={action} />
    </>
  );
}

let now = 1_000_000;
beforeEach(() => { now = 1_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); });

async function callAndReturn() {
  fireEvent.click(screen.getByRole('link', { name: 'Call' }));
  act(() => { window.dispatchEvent(new Event('blur')); });
  now += 45_000;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
}

describe('CallFollowUp', () => {
  it('offers to log the call after coming back, and saves the chosen outcome', async () => {
    const action = vi.fn<(id: string, state: CallLogState, form: FormData) => Promise<CallLogState>>(async () => ({ status: 'saved' }));
    render(<Page action={action} />);
    await callAndReturn();

    expect(screen.getByRole('dialog', { name: 'Your call with Ana Cruz' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Left a voicemail'));
    expect(screen.getByLabelText('In 3 days')).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save to timeline' }));

    expect(action).toHaveBeenCalledTimes(1);
    const [id, , data] = action.mock.calls[0]!;
    expect(id).toBe('c-ana');
    expect(data.get('outcome')).toBe('voicemail');
    expect(data.get('followUp')).toBe('three-days');
    expect(await screen.findByText(/Saved to Ana’s timeline/)).toBeInTheDocument();
  });

  it('does not ask when the app never lost focus', async () => {
    render(<Page action={vi.fn()} />);
    fireEvent.click(screen.getByRole('link', { name: 'Call' }));
    now += 45_000;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can be turned off for this device', async () => {
    render(<Page action={vi.fn()} />);
    await callAndReturn();
    await userEvent.click(screen.getByRole('button', { name: 'Don’t ask after calls on this device' }));
    expect(localStorage.getItem(CALL_PROMPT_PREFERENCE_KEY)).toBe('off');
    await callAndReturn();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
