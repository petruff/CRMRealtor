'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { CheckCircle2, Mail, Send, ShieldCheck } from 'lucide-react';
import { INITIAL_GOOGLE_EMAIL_ACTION_STATE } from '@/app/contacts/action-state';
import { approveAndSendGoogleEmailAction, prepareGoogleEmailAction } from '@/app/contacts/google-actions';

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="sk-primary-button" disabled={pending}>{pending ? 'Preparing…' : 'Prepare for approval'}</button>;
}

function ApprovalSubmit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="sk-primary-button" disabled={pending}><Send className="size-4" aria-hidden />{pending ? 'Sending securely…' : 'Approve and send'}</button>;
}

function GoogleEmailApproval(input: {
  readonly intentId: string;
  readonly intentVersion: number;
  readonly recipient: string;
  readonly subject: string;
}) {
  const [state, action] = useActionState(approveAndSendGoogleEmailAction, INITIAL_GOOGLE_EMAIL_ACTION_STATE);
  if (state.phase === 'sent' || state.phase === 'queued') {
    return <div className="mt-4 rounded-2xl border border-nurture-border bg-nurture-soft p-4" role="status"><p className="flex items-start gap-2 text-sm font-medium text-nurture"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />{state.message}</p></div>;
  }
  return (
    <form action={action} className="mt-4 rounded-2xl border border-accent/30 bg-surface p-4 shadow-sm" aria-label="Review and approve Gmail email">
      <input type="hidden" name="intentId" value={input.intentId} />
      <input type="hidden" name="intentVersion" value={input.intentVersion} />
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><ShieldCheck className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">Final review</p><p className="mt-1 break-words text-xs leading-relaxed text-muted">To <strong className="text-ink">{input.recipient}</strong><br />Subject: <strong className="text-ink">{input.subject}</strong></p></div>
      </div>
      <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-sm text-ink"><input type="checkbox" name="confirmed" value="yes" required className="mt-0.5 size-4 shrink-0" /><span>I reviewed the recipient and subject and want Gmail to send this exact draft.</span></label>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted">One approval, one send. Omnix will not resend an uncertain request.</p><ApprovalSubmit /></div>
      {state.status === 'error' && state.message ? <p role="alert" className="mt-3 text-sm text-hot">{state.message}</p> : null}
    </form>
  );
}

export function GoogleEmailComposer(input: {
  readonly contactId: string;
  readonly connectionId: string;
  readonly contactPointId: string;
  readonly from: string;
  readonly to: string;
  readonly isOwner: boolean;
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
      {state.status === 'success' && state.phase === 'draft-ready' && state.intentId && state.intentVersion
        && state.recipient && state.subject ? input.isOwner ? (
          <GoogleEmailApproval intentId={state.intentId} intentVersion={state.intentVersion} recipient={state.recipient} subject={state.subject} />
        ) : (
          <div className="mt-4 rounded-2xl border border-warm-border bg-warm-soft p-4"><p className="text-sm font-medium text-warm">Waiting for the workspace owner</p><p className="mt-1 text-xs leading-relaxed text-muted">The owner can review and approve this exact draft from Connection controls.</p><Link href="/connections#pending-approvals" className="sk-text-action mt-3 inline-flex">Open pending approvals</Link></div>
        ) : null}
    </details>
  );
}
