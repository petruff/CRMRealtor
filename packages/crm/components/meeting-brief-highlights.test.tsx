/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingBriefHighlights } from './meeting-brief-highlights';
import { BriefSourceLink } from './brief-source-link';
afterEach(cleanup);
describe('opt-in brief highlights', () => {
  it('does not spend on mount and retains a useful unavailable state', async () => {
    const action = vi.fn().mockResolvedValue({ narration: { snapshotId: 's1', state: 'unconfigured', reason: 'sample-mode' } });
    render(<MeetingBriefHighlights contactId="c1" snapshotId="s1" stale={false} action={action} />);
    expect(action).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest talking points' }));
    expect(action).toHaveBeenCalledWith('c1', 's1');
    expect(await screen.findByRole('status')).toHaveTextContent('recorded context');
  });
  it('rejects a different snapshot response', async () => {
    const action = vi.fn().mockResolvedValue({ narration: { snapshotId: 'other', state: 'available', summary: { text: 'Wrong contact content' } } });
    render(<MeetingBriefHighlights contactId="c1" snapshotId="s1" stale={false} action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Suggest talking points' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh');
    expect(screen.queryByText('Wrong contact content')).not.toBeInTheDocument();
  });
  it('reveals closed evidence disclosure when a source link is activated', async () => {
    render(<><BriefSourceLink citationId="note1">Source</BriefSourceLink><details data-testid="evidence"><summary>Evidence</summary><p id="evidence-note1">Original record</p></details></>);
    await userEvent.click(screen.getByRole('link', { name: 'Source' }));
    expect(screen.getByTestId('evidence')).toHaveAttribute('open');
  });
  it('hides previously generated highlights when the same snapshot becomes stale', async () => {
    const action = vi.fn().mockResolvedValue({ narration: { snapshotId: 's1', state: 'available', summary: { text: 'Recorded commitment', citationIds: [] }, talkingPoints: [] } });
    const view = render(<MeetingBriefHighlights contactId="c1" snapshotId="s1" stale={false} action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Suggest talking points' }));
    expect(await screen.findByText('Recorded commitment')).toBeInTheDocument();
    view.rerender(<MeetingBriefHighlights contactId="c1" snapshotId="s1" stale action={action} />);
    expect(screen.queryByText('Recorded commitment')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suggest talking points' })).toBeDisabled();
  });
});
