'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, Download, ExternalLink, Mail, MessageSquare, QrCode } from 'lucide-react';
import type { LeadPageSetupState } from '@/app/lead-page/actions';

type CreateAction = (state: LeadPageSetupState, formData: FormData) => Promise<LeadPageSetupState>;

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" className={`sk-primary-button${pending ? ' ox-busy' : ''}`} disabled={pending}><QrCode className="size-4" aria-hidden />{pending ? 'Creating…' : 'Create my lead page'}</button>;
}

export function LeadPageCreate({ action }: { action: CreateAction }) {
  const [state, formAction] = useActionState(action, { status: 'idle' } as LeadPageSetupState);
  return (
    <form action={formAction} className="ox-portal-form">
      <label className="sk-field sm:col-span-2"><span className="sk-label">I’ll reply to new leads within</span>
        <select name="responseSlaMinutes" className="sk-input" defaultValue="15">
          {[5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes === 60 ? '1 hour' : `${minutes} minutes`}</option>)}
        </select>
      </label>
      <div className="ox-portal-form-submit"><Submit /></div>
      {state.message ? <p role={state.status === 'error' ? 'alert' : 'status'} className={`text-sm sm:col-span-3 ${state.status === 'error' ? 'text-hot' : 'text-muted'}`}>{state.message}</p> : null}
    </form>
  );
}

/** Link, copy/share buttons and a printable QR code for the hosted page. */
export function LeadPageShare({ url, qrSvg, agentName }: { url: string; qrSvg: string; agentName: string }) {
  const [copied, setCopied] = useState(false);
  const message = `Thinking about buying or selling? Tell me what you’re looking for and I’ll get back to you personally: ${url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };
  const qrHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
  return (
    <div className="ox-lead-share">
      <div className="grid gap-4">
        <div className="ox-portal-url"><input readOnly value={url} aria-label="Your lead page link" onFocus={(event) => event.currentTarget.select()} className="sk-input" /></div>
        <div className="ox-portal-actions">
          <button type="button" className="sk-primary-button" onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied ? 'Copied' : 'Copy link'}</button>
          <a className="sk-secondary-button" href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />Open</a>
          <a className="sk-secondary-button" href={`sms:?&body=${encodeURIComponent(message)}`}><MessageSquare className="size-4" aria-hidden />Text it</a>
          <a className="sk-secondary-button" href={`mailto:?subject=${encodeURIComponent(`Let’s talk — ${agentName}`)}&body=${encodeURIComponent(message)}`}><Mail className="size-4" aria-hidden />Email it</a>
        </div>
      </div>
      <figure className="ox-lead-qr">
        <span dangerouslySetInnerHTML={{ __html: qrSvg }} role="img" aria-label="QR code for your lead page" />
        <figcaption><p>Scan to reach {agentName}</p></figcaption>
        <a className="sk-secondary-button" href={qrHref} download="omnix-lead-page-qr.svg"><Download className="size-4" aria-hidden />Download QR</a>
      </figure>
    </div>
  );
}
