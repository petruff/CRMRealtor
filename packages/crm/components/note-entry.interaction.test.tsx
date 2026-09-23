// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteEntry } from '@/components/contact-mutations';
import type { ContactActionState } from '@/lib/application/contact-action-state';
import type { Note } from '@/lib/domain/contact';

const note: Note = {
  id: 'note-1',
  contactId: 'contact-1',
  body: 'Wants 3 beds\nNear the park',
  createdAt: '2026-09-01T10:00:00.000Z',
};

afterEach(() => cleanup());

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
}

describe('NoteEntry inline editing', () => {
  it('shows multiline text, no Edited marker for an original note, and an Edit control', () => {
    render(<NoteEntry note={note} createdLabel="Sep 1, 2026" editAction={vi.fn()} />);
    const body = screen.getByText(/Wants 3 beds/);
    expect(body).toHaveClass('whitespace-pre-wrap');
    expect(body.textContent).toBe('Wants 3 beds\nNear the park');
    expect(screen.queryByText(/Edited/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit note from Sep 1, 2026' })).toBeInTheDocument();
  });

  it('is read only when no edit action is provided (archived contact)', () => {
    render(<NoteEntry note={note} createdLabel="Sep 1, 2026" />);
    expect(screen.queryByRole('button', { name: /edit note/i })).not.toBeInTheDocument();
  });

  it('marks a really edited note discreetly while keeping the creation date', () => {
    render(<NoteEntry note={{ ...note, revision: 2, updatedAt: '2026-09-23T12:00:00.000Z' }} createdLabel="Sep 1, 2026" editedLabel="Sep 23, 2026" />);
    expect(screen.getByText(/Sep 1, 2026/)).toHaveTextContent('Sep 1, 2026 · Edited Sep 23, 2026');
  });

  it('cancel closes the editor without calling the server and restores focus', async () => {
    const action = vi.fn();
    render(<NoteEntry note={note} createdLabel="Sep 1, 2026" editAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    const field = screen.getByLabelText('Edit note') as HTMLTextAreaElement;
    expect(field.value).toBe(note.body);
    fireEvent.change(field, { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Edit note')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /edit note/i })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe(note.body);
  });

  it('saves the multiline draft with the current revision and closes with confirmation', async () => {
    const action = vi.fn(async (_state: ContactActionState, formData: FormData): Promise<ContactActionState> => {
      expect(formData.get('body')).toBe('Wants 4 beds\nNear the lake');
      expect(formData.get('revision')).toBe('1');
      return { status: 'success', message: 'Note updated.' };
    });
    render(<NoteEntry note={note} createdLabel="Sep 1, 2026" editAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'Wants 4 beds\nNear the lake' } });
    await act(async () => submit());

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Note updated.'));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Edit note')).not.toBeInTheDocument();
  });

  it('keeps the draft and shows an accessible error when saving fails', async () => {
    const action = vi.fn(async (_state: ContactActionState, formData: FormData): Promise<ContactActionState> => ({
      status: 'error',
      message: 'This note was changed in another session. Your draft is still here — review the latest saved text below before saving again.',
      values: { body: String(formData.get('body')), revision: String(formData.get('revision')) },
    }));
    const { rerender } = render(<NoteEntry note={note} createdLabel="Sep 1, 2026" editAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'My careful draft' } });
    await act(async () => submit());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/changed in another session/));
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('My careful draft');

    // Revalidation brings the other session's text; the draft stays and the latest text is shown.
    rerender(<NoteEntry note={{ ...note, body: 'Other session text', revision: 2, updatedAt: '2026-09-23T12:00:00.000Z' }} createdLabel="Sep 1, 2026" editAction={action} />);
    expect(screen.getByText('Latest saved text')).toBeInTheDocument();
    expect(screen.getByText('Other session text')).toBeInTheDocument();
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('My careful draft');
  });

  it('shows a field error for blank content without losing the editor', async () => {
    const action = vi.fn(async (): Promise<ContactActionState> => ({
      status: 'error', message: 'Write a note before saving.', fieldErrors: { body: 'A note cannot be blank.' }, values: { body: '   ', revision: '1' },
    }));
    render(<NoteEntry note={note} createdLabel="Sep 1, 2026" editAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: '   ' } });
    await act(async () => submit());

    await waitFor(() => expect(screen.getByText('A note cannot be blank.')).toBeInTheDocument());
    expect(screen.getByLabelText('Edit note')).toHaveAttribute('aria-invalid', 'true');
  });
});
