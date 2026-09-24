/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OmnixCopilot, resetOmnixCopilotMemory } from './omnix-copilot';
import type { OmnixCopilotUiResult } from './omnix-copilot-view-model';

afterEach(() => { cleanup(); resetOmnixCopilotMemory(); });
const result: OmnixCopilotUiResult = {
  status: 'success', question: 'Find Alicia', answerBlocks: [], suggestions: [], alerts: [], warnings: [],
  citations: [{ id: 'cited-alicia', entityType: 'contact', recordId: 'c-alicia', factKeys: ['firstName'], asOf: '2026-09-07T12:00:00Z', target: '/contacts/c-alicia', displayLabel: 'Alicia Morgan' }],
};

describe('Omnix workspace conversation', () => {
  it('defaults to CRM and sends only the selected client identity on follow-up', async () => {
    const action = vi.fn().mockResolvedValue(result);
    render(<OmnixCopilot action={action} />);
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'CRM' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'What should I do today?' }));
    expect(action).toHaveBeenCalledWith('What should I do today?', { source: 'crm' });
    await userEvent.click(await screen.findByRole('button', { name: 'Ask about Alicia Morgan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Client status' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith('Show this client status', { source: 'crm', contactId: 'c-alicia' }));
    expect(screen.getByRole('link', { name: /Organize notes/ })).toHaveAttribute('href', '/contacts/c-alicia/outcome');
  });
  it('drops selected CRM context when switching to public research', async () => {
    const action = vi.fn().mockResolvedValue(result);
    render(<OmnixCopilot action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'What should I do today?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ask about Alicia Morgan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Public web' }));
    expect(screen.queryByRole('button', { name: 'Clear selected client' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'Florida housing trends');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Omnix' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith('Florida housing trends', { source: 'public-web' }));
  });

  it('keeps the conversation when the assistant is reopened on another page', async () => {
    const action = vi.fn().mockResolvedValue({ ...result, answerBlocks: [{ id: 'b', kind: 'summary', title: 'Today', detail: 'Two people need you.', items: [], citationIds: [] }] });
    const { unmount } = render(<OmnixCopilot action={action} mode="assistant" />);
    await userEvent.click(screen.getByRole('button', { name: 'What should I do today?' }));
    expect(await screen.findByText('Two people need you.')).toBeInTheDocument();
    unmount();
    render(<OmnixCopilot action={action} mode="assistant" />);
    expect(screen.getByText('Two people need you.')).toBeInTheDocument();
  });

  it('uses the open contact for follow-ups and offers contact prompts', async () => {
    const action = vi.fn().mockResolvedValue(result);
    render(<OmnixCopilot action={action} contextContact={{ id: 'c-alicia', name: 'Alicia Morgan' }} />);
    expect(screen.getByRole('button', { name: 'Clear selected client' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tell me about Alicia' }));
    expect(action).toHaveBeenCalledWith('Tell me about Alicia', { source: 'crm', contactId: 'c-alicia' });
  });

  it('shows Call and Text for people in an answer', async () => {
    const action = vi.fn().mockResolvedValue({
      ...result,
      answerBlocks: [{ id: 'segment-results', kind: 'list', title: '1 match', detail: 'You have 1 hot lead.', citationIds: [], items: [{
        id: 'segment-c-alicia', label: 'Alicia Morgan', detail: 'Last talked 9 days ago', href: '/contacts/c-alicia', citationIds: [],
        contact: { id: 'c-alicia', name: 'Alicia Morgan', firstName: 'Alicia', phone: '(305) 555-0101' },
      }] }],
    });
    render(<OmnixCopilot action={action} />);
    await userEvent.type(screen.getByRole('textbox'), 'Who are my hot leads?');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Omnix' }));
    const call = await screen.findByRole('link', { name: 'Call Alicia Morgan' });
    expect(call).toHaveAttribute('href', 'tel:3055550101');
    expect(call).toHaveAttribute('data-call-contact', 'c-alicia');
    expect(screen.getByRole('link', { name: 'Text Alicia Morgan' })).toHaveAttribute('href', 'sms:3055550101');
  });

  it('saves a follow-up only after the realtor taps Save', async () => {
    const confirm = vi.fn().mockResolvedValue({ status: 'saved', message: 'Follow-up saved for Alicia Morgan.', href: '/contacts/c-alicia' });
    const action = vi.fn().mockResolvedValue({
      ...result, citations: [], intent: 'create-task', message: 'Check the follow-up and tap Save.',
      action: { type: 'create-task', person: { id: 'c-alicia', name: 'Alicia Morgan', firstName: 'Alicia' }, title: 'Call Alicia Morgan', dueDate: '2026-09-25', dueTime: '10:00', dueLabel: 'Tomorrow at 10 AM' },
    });
    render(<OmnixCopilot action={action} confirm={confirm} />);
    await userEvent.type(screen.getByRole('textbox'), 'Remind me to call Alicia tomorrow at 10');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Omnix' }));
    const title = await screen.findByRole('textbox', { name: 'Follow-up' });
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.clear(title);
    await userEvent.type(title, 'Call Alicia about the inspection');
    await userEvent.click(screen.getByRole('button', { name: 'Save follow-up' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ type: 'create-task', contactId: 'c-alicia', title: 'Call Alicia about the inspection', dueDate: '2026-09-25', dueTime: '10:00' }));
    expect(await screen.findByText('Follow-up saved for Alicia Morgan.')).toBeInTheDocument();
  });

  it('re-asks with the chosen person when a name is ambiguous', async () => {
    const action = vi.fn()
      .mockResolvedValueOnce({ ...result, citations: [], message: 'Which one?', action: { type: 'choose-contact', candidates: [
        { id: 'c-1', name: 'Ana Silva', firstName: 'Ana', detail: 'Miami' }, { id: 'c-2', name: 'Ana Costa', firstName: 'Ana', detail: 'Orlando' },
      ] } })
      .mockResolvedValue(result);
    render(<OmnixCopilot action={action} />);
    await userEvent.type(screen.getByRole('textbox'), 'Draft a text to Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Omnix' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ana Costa/ }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith('Draft a text to Ana', { source: 'crm', contactId: 'c-2' }));
  });

  it('records helpful / not helpful without resending the question', async () => {
    const feedback = vi.fn(async () => undefined);
    const action = vi.fn().mockResolvedValue({ ...result, correlationId: 'corr-12345678', intent: 'segment' });
    render(<OmnixCopilot action={action} feedback={feedback} />);
    await userEvent.click(screen.getByRole('button', { name: 'What should I do today?' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, this helped' }));
    expect(feedback).toHaveBeenCalledWith({ correlationId: 'corr-12345678', intent: 'segment', helpful: true });
    expect(screen.getByText('Thanks — glad that helped.')).toBeInTheDocument();
  });
});
