// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import type { ContactAssignment } from '@/lib/domain/rich-contact';
import type { WorkspaceMembership } from '@/lib/domain/workspace';

vi.mock('@/app/contacts/rich-actions', () => ({ setAssignmentAction: vi.fn() }));

import { WorkspaceAssignmentPanel } from './workspace-assignment-panel';

const contact: Contact = {
  id: 'contact-a', firstName: 'Judith', lastName: 'Client', leadType: 'hot',
  relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'new',
  tags: [], createdAt: '2026-08-23T12:00:00.000Z', updatedAt: '2026-08-23T12:00:00.000Z',
};

const members: WorkspaceMembership[] = [
  { id: 'member-owner', workspaceId: 'workspace-a', userId: 'raw-owner-user-id', role: 'owner', status: 'active', joinedAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' },
  { id: 'member-assistant', workspaceId: 'workspace-a', userId: 'raw-assistant-user-id', role: 'assistant', status: 'active', joinedAt: '2026-08-02T12:00:00.000Z', updatedAt: '2026-08-02T12:00:00.000Z' },
];

describe('WorkspaceAssignmentPanel', () => {
  afterEach(cleanup);

  it('shows human role labels and never exposes user identifiers', () => {
    const assignments: ContactAssignment[] = [{
      id: 'assignment-a', workspaceId: 'workspace-a', contactId: 'contact-a',
      assigneeMembershipId: 'member-owner', assignedByMembershipId: 'member-owner',
      assignedAt: '2026-08-23T12:00:00.000Z',
    }];
    render(<WorkspaceAssignmentPanel contacts={[contact]} assignments={assignments} members={members} currentMembershipId="member-owner" />);

    expect(screen.getByText('You · Owner')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Assistant' })).toHaveValue('member-assistant');
    expect(screen.queryByText(/raw-owner-user-id|raw-assistant-user-id/)).not.toBeInTheDocument();
  });

  it('keeps large workspaces bounded and supports search plus progressive disclosure', () => {
    const contacts = Array.from({ length: 30 }, (_, index) => ({
      ...contact,
      id: `contact-${index + 1}`,
      firstName: `Client ${index + 1}`,
      lastName: 'Example',
    }));
    render(<WorkspaceAssignmentPanel contacts={contacts} assignments={[]} members={members} currentMembershipId="member-owner" />);

    expect(screen.getByText('Showing 24 of 30 matching contacts')).toBeInTheDocument();
    expect(screen.queryByText('Client 25 Example')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 6 more' }));
    expect(screen.getByText('Client 25 Example')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search contacts to assign' }), { target: { value: 'Client 30' } });
    expect(screen.getByText('Showing 1 of 1 matching contacts')).toBeInTheDocument();
    expect(screen.getByText('Client 30 Example')).toBeInTheDocument();
    expect(screen.queryByText('Client 1 Example')).not.toBeInTheDocument();
  });
});
