/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OmnixCopilot } from './omnix-copilot';
import type { OmnixCopilotUiResult } from './omnix-copilot-view-model';

afterEach(cleanup);
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
    await userEvent.click(screen.getByRole('button', { name: 'Workspace overview' }));
    expect(action).toHaveBeenCalledWith('Workspace overview', { source: 'crm' });
    await userEvent.click(await screen.findByRole('button', { name: 'Ask about Alicia Morgan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Client status' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith('Show this client status', { source: 'crm', contactId: 'c-alicia' }));
    expect(screen.getByRole('link', { name: /Organize notes/ })).toHaveAttribute('href', '/contacts/c-alicia/outcome');
  });
  it('drops selected CRM context when switching to public research', async () => {
    const action = vi.fn().mockResolvedValue(result);
    render(<OmnixCopilot action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Workspace overview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ask about Alicia Morgan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Public web' }));
    expect(screen.queryByRole('button', { name: 'Clear selected client' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'Florida housing trends');
    await userEvent.click(screen.getByRole('button', { name: 'Ask Omnix' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith('Florida housing trends', { source: 'public-web' }));
  });
});
