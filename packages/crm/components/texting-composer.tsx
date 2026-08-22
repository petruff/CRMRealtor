'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { MessageSquare, ShieldCheck } from 'lucide-react';
import { INITIAL_TEXTING_ACTION_STATE } from '@/app/contacts/action-state';
import {
  prepareTextingMessageAction,
  recordTextingConsentAction,
  requestTextingUatAction,
} from '@/app/contacts/texting-actions';

function Submit({ children }: { readonly children: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="sk-primary-button" disabled={pending}>{pending ? 'Saving…' : children}</button>;
}

export function TextingComposer(input: {
  readonly contactId: string;
  readonly connectionId: string;
  readonly contactPointId: string;
  readonly recipientPhone: string;
  readonly useCase: string;
  readonly disclosureVersion: string;
  readonly consentStatus?: string;
  readonly recipientTimeZone?: string;
  readonly realNumberUatRequired?: boolean;
  readonly messages?: readonly { readonly id: string; readonly direction: 'inbound' | 'outbound'; readonly status: string; readonly createdAt: string; readonly errorCategory?: string }[];
}) {
  const [draftState, draftAction] = useActionState(prepareTextingMessageAction, INITIAL_TEXTING_ACTION_STATE);
  const [consentState, consentAction] = useActionState(recordTextingConsentAction, INITIAL_TEXTING_ACTION_STATE);
  const [uatState, uatAction] = useActionState(requestTextingUatAction, INITIAL_TEXTING_ACTION_STATE);
  const shared = <>
    <input type="hidden" name="contactId" value={input.contactId} />
    <input type="hidden" name="connectionId" value={input.connectionId} />
    <input type="hidden" name="contactPointId" value={input.contactPointId} />
    <input type="hidden" name="useCase" value={input.useCase} />
  </>;
  return (
    <details className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-accent">
        <MessageSquare className="size-4" aria-hidden /> Text with Omnix · {input.consentStatus ?? 'consent unknown'}
      </summary>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form action={consentAction} className="grid gap-3 rounded-xl border border-line p-4">
          {shared}
          <input type="hidden" name="disclosureVersion" value={input.disclosureVersion} />
          <input type="hidden" name="timezoneSource" value={input.recipientTimeZone ? 'verified-workspace-evidence' : ''} />
          <label className="sk-field"><span className="sk-label">Consent decision</span><select name="status" className="sk-input" required defaultValue="opted_in"><option value="opted_in">Explicitly opted in</option><option value="opted_out">Opted out</option><option value="unknown">Unknown</option></select></label>
          <label className="sk-field"><span className="sk-label">How it was collected</span><input name="collectionMethod" className="sk-input" placeholder="Signed form, recorded call…" maxLength={64} required /></label>
          <label className="sk-field"><span className="sk-label">Evidence reference</span><input name="evidenceReference" className="sk-input" placeholder="Document or record reference" maxLength={1024} required /></label>
          <label className="sk-field"><span className="sk-label">Verified timezone</span><input name="recipientTimeZone" className="sk-input" defaultValue={input.recipientTimeZone ?? ''} placeholder="America/New_York" maxLength={120} /></label>
          <Submit>Record evidence</Submit>
          {consentState.message ? <p role={consentState.status === 'error' ? 'alert' : 'status'} className="text-sm text-muted">{consentState.message}</p> : null}
        </form>
        <form action={input.realNumberUatRequired ? uatAction : draftAction} className="grid gap-3 rounded-xl border border-line p-4">
          {shared}
          <input type="hidden" name="recipientPhone" value={input.recipientPhone} />
          <input type="hidden" name="recipientTimeZone" value={input.recipientTimeZone ?? ''} />
          <input type="hidden" name="timezoneSource" value={input.recipientTimeZone ? 'verified-workspace-evidence' : ''} />
          <label className="sk-field"><span className="sk-label">Recipient</span><input className="sk-input" value={input.recipientPhone} readOnly /></label>
          <label className="sk-field"><span className="sk-label">Message</span><textarea name="body" className="sk-input min-h-36" maxLength={1600} required /></label>
          <p className="inline-flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> {input.realNumberUatRequired
            ? 'This controlled test uses the same current consent, verified phone, quiet-hours policy and encrypted content. One final Twilio delivery receipt is required to activate ordinary sends.'
            : 'Omnix rechecks the exact phone, consent, policy and quiet hours. The owner approves the encrypted draft before Twilio is called.'}</p>
          <Submit>{input.realNumberUatRequired ? 'Queue controlled real-number UAT' : 'Prepare for owner approval'}</Submit>
          {(input.realNumberUatRequired ? uatState : draftState).message ? <p role={(input.realNumberUatRequired ? uatState : draftState).status === 'error' ? 'alert' : 'status'} className="text-sm text-muted">{(input.realNumberUatRequired ? uatState : draftState).message}</p> : null}
        </form>
      </div>
      {input.messages?.length ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-medium text-ink">Recent provider receipts</p>
          <ol className="mt-2 grid gap-2">
            {input.messages.slice(0, 5).map((message) => (
              <li key={message.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs">
                <span className="text-ink">{message.direction} · {message.status.replaceAll('_', ' ')}</span>
                <span className="text-muted">{new Date(message.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </details>
  );
}
