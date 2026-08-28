/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleEmailComposer } from '@/components/google-email-composer';

const actions = vi.hoisted(() => ({ prepare: vi.fn(), approve: vi.fn() }));
vi.mock('@/app/contacts/google-actions', () => ({
  prepareGoogleEmailAction: actions.prepare,
  approveAndSendGoogleEmailAction: actions.approve,
}));

const input = {
  contactId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  contactPointId: '33333333-3333-4333-8333-333333333333',
  from: 'owner@example.com',
  to: 'client@example.com',
};

describe('GoogleEmailComposer', () => {
  afterEach(() => {
    cleanup();
    actions.prepare.mockReset();
    actions.approve.mockReset();
  });

  it('gives the workspace owner an inline final review and send action', async () => {
    actions.prepare.mockResolvedValue({
      status: 'success', phase: 'draft-ready', message: 'Draft ready.',
      intentId: '44444444-4444-4444-8444-444444444444', intentVersion: 1,
      recipient: input.to, subject: 'Home search update',
    });
    actions.approve.mockResolvedValue({
      status: 'success', phase: 'sent', message: 'Sent with Gmail. The delivery record is now saved in Omnix.',
    });
    const user = userEvent.setup();
    render(<GoogleEmailComposer {...input} isOwner />);

    await user.click(screen.getByText('Compose with Gmail'));
    await user.type(screen.getByRole('textbox', { name: 'Subject' }), 'Home search update');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello from Omnix.');
    await user.click(screen.getByRole('button', { name: 'Prepare for approval' }));

    expect(await screen.findByRole('form', { name: 'Review and approve Gmail email' })).toBeInTheDocument();
    expect(screen.getByText('client@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the recipient and subject/i }));
    await user.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(await screen.findByText(/Sent with Gmail/)).toBeInTheDocument();
  });

  it('keeps assistant-created drafts waiting for owner approval', async () => {
    actions.prepare.mockResolvedValue({
      status: 'success', phase: 'draft-ready', message: 'Draft ready and waiting for the workspace owner.',
      intentId: '44444444-4444-4444-8444-444444444444', intentVersion: 1,
      recipient: input.to, subject: 'Follow-up',
    });
    const user = userEvent.setup();
    render(<GoogleEmailComposer {...input} isOwner={false} />);

    await user.click(screen.getByText('Compose with Gmail'));
    await user.type(screen.getByRole('textbox', { name: 'Subject' }), 'Follow-up');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Checking in.');
    await user.click(screen.getByRole('button', { name: 'Prepare for approval' }));

    expect(await screen.findByText('Waiting for the workspace owner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open pending approvals' })).toHaveAttribute('href', '/connections#pending-approvals');
  });
});
