'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, StickyNote } from 'lucide-react';
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
          <span id="note-help" className="sk-help">Saved notes are timestamped and cannot be edited.</span>
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
