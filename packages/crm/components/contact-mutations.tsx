'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Pencil, Save, StickyNote } from 'lucide-react';
import type { Note } from '@/lib/domain/contact';
import {
  INITIAL_CONTACT_ACTION_STATE,
  type ContactActionState,
} from '@/lib/application/contact-action-state';

type ContactMutationAction = (
  state: ContactActionState,
  formData: FormData,
) => Promise<ContactActionState>;

function PendingButton({
  idleLabel,
  pendingLabel,
  icon,
  className,
}: {
  idleLabel: string;
  pendingLabel: string;
  icon: React.ReactNode;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {icon}
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

export function RecordTouchForm({ action }: { action: ContactMutationAction }) {
  const [state, formAction] = useActionState(action, INITIAL_CONTACT_ACTION_STATE);
  return (
    <form action={formAction} className="mt-4 min-w-0 border-t border-line pt-4">
      <PendingButton
        idleLabel="Mark as contacted"
        pendingLabel="Recording…"
        icon={<Check className="size-4" />}
        className="sk-primary-button w-full sm:w-auto"
      />
      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-sm text-hot">{state.message}</p>
      ) : null}
    </form>
  );
}

export function AddNoteForm({ action }: { action: ContactMutationAction }) {
  const [state, formAction] = useActionState(action, INITIAL_CONTACT_ACTION_STATE);
  const bodyError = state.fieldErrors?.body;
  return (
    <form key={state.values ? JSON.stringify(state.values) : 'initial'} action={formAction} className="mb-5 rounded-[1.25rem] bg-surface-2 p-4 sm:p-5">
      <label className="sk-field">
        <span className="sk-label flex items-center gap-2">
          <StickyNote className="size-4 text-accent" /> Add a note
        </span>
        <textarea
          name="body"
          rows={4}
          defaultValue={state.values?.body}
          placeholder="What matters for the next conversation?"
          className="sk-input resize-y"
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? 'body-error' : 'note-help'}
        />
        {bodyError ? (
          <span id="body-error" className="sk-error">{bodyError}</span>
        ) : (
          <span id="note-help" className="sk-help">Saved notes are timestamped. You can edit them later; earlier text is kept in the note&apos;s history.</span>
        )}
      </label>
      {state.status === 'error' && state.message && !bodyError ? (
        <p role="alert" className="mt-2 text-sm text-hot">{state.message}</p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <PendingButton
          idleLabel="Save note"
          pendingLabel="Saving…"
          icon={<StickyNote className="size-4" />}
          className="sk-primary-button"
        />
      </div>
    </form>
  );
}

function CancelButton({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="button" onClick={onCancel} disabled={pending} className="sk-secondary-button">
      Cancel
    </button>
  );
}

function NoteEditor({
  note,
  action,
  createdLabel,
  onClose,
}: {
  note: Note;
  action: ContactMutationAction;
  createdLabel: string;
  /** Receives the confirmation text after a save, or undefined after Cancel. */
  onClose: (confirmation?: string) => void;
}) {
  const [state, formAction] = useActionState(async (previous: ContactActionState, formData: FormData) => {
    const next = await action(previous, formData);
    if (next.status === 'success') onClose(next.message ?? 'Note updated.');
    return next;
  }, INITIAL_CONTACT_ACTION_STATE);
  const fieldId = useId();
  const bodyError = state.fieldErrors?.body;
  const revision = String(note.revision ?? 1);
  // A failed save returns the submitted draft; the editor re-renders with it so nothing typed is lost.
  const draft = state.status === 'error' ? state.values?.body : undefined;
  const staleDraft = state.status === 'error' && state.values?.revision !== undefined && state.values.revision !== revision;
  const text = draft ?? note.body;
  return (
    <form
      key={state.values ? JSON.stringify(state.values) : 'editor'}
      action={formAction}
      className="rounded-xl border border-line bg-surface-2 p-3"
      aria-label={`Edit note from ${createdLabel}`}
    >
      {staleDraft ? (
        <div className="mb-3 rounded-lg border border-warm-border bg-warm-soft p-3">
          <p className="text-xs font-medium text-warm">Latest saved text</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{note.body}</p>
        </div>
      ) : null}
      <div className="sk-field">
        <label htmlFor={fieldId} className="sk-label">Edit note</label>
        <textarea
          id={fieldId}
          name="body"
          rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
          defaultValue={text}
          autoFocus
          className="sk-input resize-y"
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? `${fieldId}-error` : `${fieldId}-help`}
        />
        {bodyError ? (
          <span id={`${fieldId}-error`} className="sk-error">{bodyError}</span>
        ) : (
          <span id={`${fieldId}-help`} className="sk-help">Created {createdLabel}. The original date stays the same.</span>
        )}
      </div>
      <input type="hidden" name="revision" value={revision} />
      {state.status === 'error' && state.message && !bodyError ? (
        <p role="alert" className="mt-2 text-sm text-hot">{state.message}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <CancelButton onCancel={() => onClose()} />
        <PendingButton
          idleLabel="Save changes"
          pendingLabel="Saving…"
          icon={<Save className="size-4" />}
          className="sk-primary-button"
        />
      </div>
    </form>
  );
}

/**
 * One note in the timeline. Editing happens inline and replaces the text in
 * place; the note keeps its id, contact and creation date, and shows a quiet
 * "Edited" marker once it has really been changed.
 */
export function NoteEntry({
  note,
  editAction,
  createdLabel,
  editedLabel,
}: {
  note: Note;
  /** Omitted for read-only records (archived contact or archived note). */
  editAction?: ContactMutationAction;
  createdLabel: string;
  editedLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<string>();
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // Return keyboard focus to the Edit control after Save or Cancel.
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const edited = Boolean(note.updatedAt) && (note.revision ?? 1) > 1;
  return (
    <div>
      {editing && editAction ? (
        <NoteEditor
          note={note}
          action={editAction}
          createdLabel={createdLabel}
          onClose={(message) => { setConfirmation(message); setEditing(false); }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{note.body}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[11px] text-subtle">
          {createdLabel}
          {edited ? <span> · Edited{editedLabel ? ` ${editedLabel}` : ''}</span> : null}
        </p>
        {editAction && !editing ? (
          <button
            ref={editButton}
            type="button"
            onClick={() => { setConfirmation(undefined); setEditing(true); }}
            className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
            aria-label={`Edit note from ${createdLabel}`}
          >
            <Pencil className="size-3.5" aria-hidden /> Edit
          </button>
        ) : null}
        {confirmation && !editing ? <span role="status" className="text-xs text-nurture">{confirmation}</span> : null}
      </div>
    </div>
  );
}

export function ArchiveNoteForm({ action }: { action: ContactMutationAction }) {
  const [state, formAction] = useActionState(action, INITIAL_CONTACT_ACTION_STATE);
  return <form action={formAction} className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
    <label className="sk-field"><span className="sk-label">Archive reason</span>
      <input name="reason" required minLength={3} maxLength={500} className="sk-input" placeholder="Duplicate note, outdated context…" />
    </label>
    {state.status === 'error' ? <p role="alert" className="mt-2 text-sm text-hot">{state.message}</p> : null}
    <button type="submit" className="sk-secondary-button mt-3">Archive note</button>
  </form>;
}

export function RestoreNoteForm({ action }: { action: ContactMutationAction }) {
  const [state, formAction] = useActionState(action, INITIAL_CONTACT_ACTION_STATE);
  return <form action={formAction} className="mt-3">
    {state.status === 'error' ? <p role="alert" className="mb-2 text-sm text-hot">{state.message}</p> : null}
    <button type="submit" className="sk-secondary-button">Restore note</button>
  </form>;
}
