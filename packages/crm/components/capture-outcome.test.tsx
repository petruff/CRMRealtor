/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureOutcome } from './capture-outcome';
import type { CaptureOutcomeProposal } from '@/lib/domain/capture-outcome';

const review: CaptureOutcomeProposal = {
  schemaVersion: 'capture-outcome.v1', id: 'review-1', workspaceId: 'workspace-sample', contactId: 'c-1', createdByMembershipId: 'membership-sample-owner',
  sourceText: 'Client is not ready to list.', sourceHash: 'source', targetHash: 'target', summary: 'Client is not ready to list.', facts: [], unknowns: [],
  extractionState: 'manual', version: 3, revision: 3, contentHash: 'current-hash', status: 'selected', createdAt: '2026-09-07T10:00:00Z', expiresAt: '2026-09-14T10:00:00Z', retentionState: 'workspace-record',
  operations: [{ id: 'note-1', type: 'note-append', before: null, after: { text: 'Client is not ready to list.' }, evidence: null, confidence: 'manual', flags: [], selected: true, state: 'pending' }],
};
afterEach(cleanup);
describe('Capture outcome review', () => {
  it('adds a manual pipeline change to review without executing it', async () => {
    const options = { pipelineStage: 'new', pipelineStages: { new: 'New', nurture: 'Nurture' }, nurturePlans: [], tasks: [], connections: [], emailRecipients: [], providerPreparationAvailable: false };
    const action = vi.fn().mockResolvedValueOnce({ options }).mockResolvedValueOnce({ proposal: { ...review, version: 4 } });
    render(<CaptureOutcome contactId="c-1" contactName="Client" isLive={false} initialProposal={review} action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add another change' }));
    await userEvent.selectOptions(await screen.findByLabelText('New relationship stage'), 'nurture');
    await userEvent.click(screen.getByRole('button', { name: 'Add to review' }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith({ command: 'add', contactId: 'c-1', proposalId: 'review-1', version: 3, operationType: 'pipeline-move', patch: { toStage: 'nurture' } }));
    expect(action.mock.calls.some(([input]) => input.command === 'confirm')).toBe(false);
  });
  it('keeps provider intent distinct from a completed action', () => {
    render(<CaptureOutcome contactId="c-1" contactName="Client" isLive initialProposal={{ ...review, status: 'awaiting-provider', operations: [{ ...review.operations[0]!, type: 'google-email-draft', state: 'awaiting-provider', childProposalId: 'child', receipt: 'connector-intent:1', after: { subject: 'Follow-up', body: 'Thanks for speaking.' } }] }} action={vi.fn()} />);
    expect(screen.getByText(/Provider items still need approval/)).toBeInTheDocument();
    expect(screen.queryByText('Selected items saved. Review their receipts below.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm and save' })).not.toBeInTheDocument();
  });
  it('prepares a model-free recap without confirming or mutating the contact', async () => {
    const action = vi.fn().mockResolvedValue({ proposal: review });
    render(<CaptureOutcome contactId="c-1" contactName="Client" isLive={false} action={action} />);
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: review.sourceText } });
    await userEvent.click(screen.getByRole('button', { name: 'Prepare note without AI' }));
    await screen.findByRole('heading', { name: 'Review the next steps.' });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ command: 'analyze', manualOnly: true, contactId: 'c-1', sourceText: review.sourceText }));
    expect(screen.queryByRole('button', { name: 'Confirm and save' })).not.toBeInTheDocument();
  });
  it('requires a separate confirmation and binds it to the displayed version and hash', async () => {
    const action = vi.fn().mockResolvedValue({ proposal: { ...review, status: 'completed' } });
    render(<CaptureOutcome contactId="c-1" contactName="Client" isLive initialProposal={review} action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review selected changes' }));
    expect(action).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(action).toHaveBeenCalledWith({ command: 'confirm', contactId: 'c-1', proposalId: 'review-1', version: 3, contentHash: 'current-hash' }));
  });
  it('offers receipt recovery instead of editing an already claimed review', async () => {
    const action = vi.fn().mockResolvedValue({});
    render(<CaptureOutcome contactId="c-1" contactName="Client" isLive initialProposal={{ ...review, status: 'partially-completed', operations: [{ ...review.operations[0]!, state: 'failed', childProposalId: 'child-1' }] }} action={action} />);
    expect(screen.queryByText('Edit note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject review' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry unfinished items' }));
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ command: 'confirm', contentHash: 'current-hash' }));
  });
  it('keeps a failed request reviewable and announces its error', async () => {
    const action = vi.fn().mockResolvedValue({ error: 'The review changed. Reload the current version.' });
    render(<CaptureOutcome contactId="c-1" contactName="Client" isLive initialProposal={review} action={action} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The review changed');
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
