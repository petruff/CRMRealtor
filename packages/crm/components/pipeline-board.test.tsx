// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import type { PipelineEvidenceResult } from '@/lib/application/pipeline-evidence';

const movePipelineStageAction = vi.fn();
vi.mock('@/app/pipeline/actions', () => ({ movePipelineStageAction: (...args: unknown[]) => movePipelineStageAction(...args) }));

import { PipelineBoard } from '@/components/pipeline-board';

const contact: Contact = {
  id: 'contact-1', firstName: 'Judith', lastName: 'Client', leadType: 'hot',
  relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'active',
  tags: [], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-12T12:00:00.000Z',
};

const evidence: PipelineEvidenceResult = {
  availability: 'available',
  byContactId: {
    [contact.id]: {
      nextStep: {
        kind: 'task', date: '2026-08-14T15:00:00.000Z', label: 'Confirm inspection',
        source: 'Open CRM task', href: '/activities?contactId=contact-1',
      },
      latestActivity: {
        type: 'task-created', occurredAt: '2026-08-12T12:00:00.000Z',
        source: 'CRM activity history', href: '/contacts/contact-1',
      },
    },
  },
};

function pipeline(contacts: readonly Contact[] = [contact], value: PipelineEvidenceResult = evidence) {
  return render(<PipelineBoard initialContacts={contacts} evidence={value} />);
}

function dragHandle(container: HTMLElement): HTMLElement {
  const handle = container.querySelector<HTMLElement>('.pipeline-drag-handle');
  if (!handle) throw new Error('Expected the pointer drag handle.');
  return handle;
}

describe('PipelineBoard', () => {
  afterEach(cleanup);

  beforeEach(() => {
    movePipelineStageAction.mockReset();
    movePipelineStageAction.mockResolvedValue({ ok: true, message: 'Pipeline stage saved.', updatedAt: '2026-08-22T12:00:00.000Z' });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it('prioritizes next action and keeps readable activity evidence behind disclosure', async () => {
    const user = userEvent.setup();
    pipeline();
    expect(screen.getByRole('link', { name: /Confirm inspection/ })).toHaveTextContent('Aug 14, 3:00 PM');
    expect(screen.queryByText(/task created/)).not.toBeVisible();
    await user.click(screen.getByText('Activity details'));
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('Last activity: task created on Aug 12, 12:00 PM') === true)).toBeVisible();
    expect(screen.queryByText(/stored stage|updated 2026/i)).not.toBeInTheDocument();
  });

  it('moves through the accessible selector and announces the saved destination', async () => {
    const user = userEvent.setup();
    pipeline();
    await user.selectOptions(screen.getByLabelText('Move to'), 'contacted');
    await waitFor(() => expect(movePipelineStageAction).toHaveBeenCalledWith(expect.objectContaining({
      contactId: contact.id, fromStage: 'active', toStage: 'contacted',
    })));
    expect(await screen.findByText('Judith Client moved to Contacted.')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Contacted' })).getByText('Judith Client')).toBeVisible();
  });

  it('keeps the drag affordance pointer-only and the Move selector as the keyboard method', async () => {
    const user = userEvent.setup();
    const { container } = pipeline();
    const handle = dragHandle(container);

    expect(handle).toHaveAttribute('aria-hidden', 'true');
    expect(handle).not.toHaveAttribute('tabindex');
    await user.tab();
    expect(handle).not.toHaveFocus();
    expect(screen.getByLabelText('Move to')).toBeEnabled();
  });

  it('restores the prior column when persistence fails', async () => {
    const user = userEvent.setup();
    movePipelineStageAction.mockResolvedValueOnce({ ok: false, message: 'The contact changed.' });
    pipeline();
    await user.selectOptions(screen.getByLabelText('Move to'), 'contacted');
    expect(await screen.findByText("We couldn't move Judith Client. Nothing changed — please try again.")).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Actively working' })).getByText('Judith Client')).toBeVisible();
  });

  it('supports pointer drag and drop through the same persisted move path', async () => {
    const { container } = pipeline();
    const handle = dragHandle(container);
    const destination = screen.getByRole('region', { name: 'Contacted' });
    document.elementFromPoint = vi.fn(() => destination);
    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
    expect(movePipelineStageAction).not.toHaveBeenCalled();
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 50 });
    await waitFor(() => expect(movePipelineStageAction).toHaveBeenCalledWith(expect.objectContaining({ toStage: 'contacted' })));
    expect(await screen.findByText('Judith Client moved to Contacted.')).toBeVisible();
  });

  it('never turns a touch gesture into drag while keeping Move to available', () => {
    const { container } = pipeline();
    const handle = dragHandle(container);
    const destination = screen.getByRole('region', { name: 'Contacted' });
    document.elementFromPoint = vi.fn(() => destination);

    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 });

    expect(movePipelineStageAction).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).not.toHaveTextContent('Dragging Judith Client');
    expect(screen.getByLabelText('Move to')).toBeEnabled();
  });

  it('uses a browser-stable touch-action split between card scrolling and the dedicated handle', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

    expect(css).toMatch(/\.pipeline-contact-card\s*\{[\s\S]*?touch-action:\s*pan-x pan-y;/);
    expect(css).toMatch(/\.pipeline-drag-handle\s*\{[\s\S]*?touch-action:\s*pan-x pan-y;/);
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{[\s\S]*?\.pipeline-drag-handle\s*\{\s*display:\s*none;/);
    expect(css).not.toContain(".pipeline-contact-card[data-dragging='true'] .pipeline-drag-handle");
  });

  it('keeps the live-region feedback visible in the rendered interface', () => {
    pipeline();
    expect(screen.getByRole('status')).toHaveClass('pipeline-live-status');
    expect(screen.getByRole('status')).toHaveTextContent('Pipeline ready');
  });

  it('filters authorized contacts and progressively reveals a large stage', async () => {
    const user = userEvent.setup();
    const contacts = Array.from({ length: 10 }, (_, index): Contact => ({
      ...contact,
      id: `contact-${index}`,
      firstName: index === 9 ? 'Warm' : 'Nurture',
      lastName: `Client ${index}`,
      leadType: index === 9 ? 'warm' : 'nurture',
      pipelineStage: 'new',
    }));
    pipeline(contacts, { availability: 'available', byContactId: {} });
    const newStage = screen.getByRole('region', { name: 'New' });
    expect(within(newStage).getAllByRole('article')).toHaveLength(8);
    await user.click(within(newStage).getByRole('button', { name: /Show 2 more/ }));
    expect(within(newStage).getAllByRole('article')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'Warm' }));
    expect(screen.getByText('1 of 10 relationships shown')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 10 relationships shown.');
    expect(screen.getByText('Warm Client 9')).toBeVisible();
    expect(screen.queryByText('Nurture Client 0')).not.toBeInTheDocument();
  });

  it('shows explicit remediation when authorized evidence is unavailable', () => {
    pipeline([contact], { availability: 'unavailable', byContactId: {} });
    expect(screen.getByText('Follow-up details are temporarily unavailable.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open activities' })).toHaveAttribute('href', '/activities');
  });
});
