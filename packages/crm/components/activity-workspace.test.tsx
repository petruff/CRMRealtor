/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrmTask } from '@/lib/domain/activity';
import { ActivityWorkspace } from '@/components/activity-workspace';

vi.mock('@/app/activities/actions', () => ({
  createTaskAction: vi.fn(),
  transitionTasksAction: vi.fn(),
}));
vi.mock('@/app/activities/google-actions', () => ({
  prepareTaskForGoogleCalendarAction: vi.fn(),
}));

function task(id: string, status: CrmTask['status'], patch: Partial<CrmTask> = {}): CrmTask {
  return {
    id,
    workspaceId: 'workspace-a',
    title: `Task ${id}`,
    dueAt: '2026-08-21T15:30:00.000Z',
    status,
    creatorMembershipId: 'member-a',
    assigneeMembershipId: 'member-a',
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...patch,
  };
}

const tasks = [
  task('open', 'open', {
    title: 'Review a very long inspection report and prepare the complete client response without losing context',
    description: 'Detailed context must wrap within the task card instead of widening the page on a phone or tablet.',
  }),
  task('complete', 'completed'),
  task('archive', 'archived'),
] as const;

describe('ActivityWorkspace responsive task authority', () => {
  afterEach(cleanup);

  it('renders one canonical task collection and preserves every row and bulk action', () => {
    render(<ActivityWorkspace
      tasks={tasks}
      contacts={[]}
      googleCalendarConnectionId="google-a"
      renderedAt="2026-08-20T12:00:00.000Z"
      timeZone="America/New_York"
    />);

    expect(screen.getAllByRole('table', { name: 'Tasks in the selected work queue' })).toHaveLength(1);
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Complete Review a very long inspection/ })).toHaveAttribute('name', 'rowIntent');
    expect(screen.getByRole('button', { name: 'Reopen Task complete' })).toHaveAttribute('value', 'reopen:complete');
    expect(screen.getByRole('button', { name: 'Archive Task complete' })).toHaveAttribute('value', 'archive:complete');
    expect(screen.getByRole('button', { name: /Prepare Review a very long inspection/ })).toHaveAttribute('form', 'google-task-open');
    expect(screen.getByRole('button', { name: /Prepare removal of Task archive/ })).toHaveAttribute('form', 'google-task-archive');
    expect(document.querySelector('#google-task-open input[name="googleTaskId"]')).toHaveAttribute('value', 'open');
    expect(document.querySelectorAll('form[id^="google-task-"]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Complete selected' })).toHaveAttribute('value', 'complete');
    expect(screen.getByRole('button', { name: 'Archive selected' })).toHaveAttribute('value', 'archive');
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
    expect(screen.getAllByText('Aug 21, 11:30 AM')).toHaveLength(3);
  });

  it('keeps selection canonical and exposes a 44px checkbox hit-area contract', async () => {
    const user = userEvent.setup();
    render(<ActivityWorkspace
      tasks={tasks}
      contacts={[]}
      renderedAt="2026-08-20T12:00:00.000Z"
      timeZone="America/New_York"
    />);

    const selectOpen = screen.getByRole('checkbox', { name: /Select Review a very long inspection/ });
    expect(selectOpen.closest('label')).toHaveClass('activity-checkbox-target');
    await user.click(selectOpen);
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Select all visible tasks' }));
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete selected' })).toBeDisabled();
  });

  it('removes the fixed table minimum and defines compact/intermediate reflow', () => {
    const source = readFileSync(join(process.cwd(), 'components', 'activity-workspace.tsx'), 'utf8');
    const pageSource = readFileSync(join(process.cwd(), 'app', 'activities', 'page.tsx'), 'utf8');
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

    expect(source).not.toContain('min-w-[38rem]');
    expect(source).toContain('activity-task-table');
    expect(css).toMatch(/\.activity-checkbox-target\s*{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;/s);
    expect(css).toMatch(/@media \(max-width:\s*63\.999rem\)[\s\S]*\.activity-task-row\s*{[^}]*grid-template-columns:\s*2\.75rem minmax\(0, 1fr\)/s);
    expect(pageSource).toMatch(/<span className="sr-only">Filter by task status<\/span>[\s\S]*?<select\s+name="status"/s);
  });

  it('keeps the truthful empty state and follow-up authority', () => {
    render(<ActivityWorkspace
      tasks={[]}
      contacts={[]}
      renderedAt="2026-08-20T12:00:00.000Z"
      timeZone="America/New_York"
    />);

    expect(screen.getByText(/No tasks match this queue/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
  });
});
