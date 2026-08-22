'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Mail, ShieldCheck } from 'lucide-react';
import { INITIAL_GOOGLE_EMAIL_ACTION_STATE } from '@/app/contacts/action-state';
import { prepareGoogleEmailAction } from '@/app/contacts/google-actions';

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="sk-primary-button" disabled={pending}>{pending ? 'Preparing…' : 'Prepare for approval'}</button>;
}

export function GoogleEmailComposer(input: {
  readonly contactId: string;
  readonly connectionId: string;
  readonly contactPointId: string;
  readonly from: string;
  readonly to: string;
}) {
  const [state, action] = useActionState(prepareGoogleEmailAction, INITIAL_GOOGLE_EMAIL_ACTION_STATE);
  return (
    <details className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-accent">
        <Mail className="size-4" aria-hidden /> Compose with Gmail
      </summary>
      <form action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="contactId" value={input.contactId} />
        <input type="hidden" name="connectionId" value={input.connectionId} />
        <input type="hidden" name="contactPointId" value={input.contactPointId} />
        <input type="hidden" name="to" value={input.to} />
        <label className="sk-field"><span className="sk-label">From</span><input className="sk-input" value={input.from} readOnly /></label>
        <label className="sk-field"><span className="sk-label">To</span><input className="sk-input" value={input.to} readOnly /></label>
        <label className="sk-field"><span className="sk-label">Subject</span><input name="subject" className="sk-input" maxLength={200} required /></label>
        <label className="sk-field"><span className="sk-label">Message</span><textarea name="body" className="sk-input min-h-36" maxLength={50000} required /></label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1 text-xs text-muted"><ShieldCheck className="size-4" aria-hidden /> Nothing sends until the owner approves the exact draft.</p>
          <Submit />
        </div>
      </form>
      {state.message ? <p role={state.status === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${state.status === 'error' ? 'text-hot' : 'text-nurture'}`}>{state.message}</p> : null}
    </details>
  );
}
