'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, Link2, Mail, MessageSquare } from 'lucide-react';
import type { PortalLinkState } from '@/app/transactions/portal-actions';
import { PORTAL_EXPIRY_CHOICES } from '@/lib/domain/client-portal';

type CreateAction = (state: PortalLinkState, formData: FormData) => Promise<PortalLinkState>;

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="sk-primary-button" disabled={pending}><Link2 className="size-4" aria-hidden />{pending ? 'Creating…' : 'Create private link'}</button>;
}

/**
 * Creates a private client link and shows it exactly once — only a hash is
 * stored, so the realtor copies or sends it right away.
 */
export function ClientPortalShare({ action, defaultAudience, propertyAddress }: { action: CreateAction; defaultAudience: string; propertyAddress: string }) {
  const [state, formAction] = useActionState(action, { status: 'idle' } as PortalLinkState);
  const [copied, setCopied] = useState(false);

  if (state.status === 'created' && state.url) {
    const message = `Here’s your private page for ${propertyAddress} — key dates and what’s next, always up to date: ${state.url}`;
    const copy = async () => {
      try { await navigator.clipboard.writeText(state.url ?? ''); setCopied(true); } catch { setCopied(false); }
    };
    return (
      <div className="ox-portal-created" role="status">
        <p className="ox-portal-created-title"><Check className="size-4" aria-hidden /> Link ready — send it now</p>
        <p className="ox-portal-created-help">For privacy, Omnix keeps only a fingerprint of this link and can’t show it again.</p>
        <div className="ox-portal-url"><input readOnly value={state.url} aria-label="Private client link" onFocus={(event) => event.currentTarget.select()} className="sk-input" /></div>
        <div className="ox-portal-actions">
          <button type="button" className="sk-primary-button" onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied ? 'Copied' : 'Copy link'}</button>
          <a className="sk-secondary-button" href={`sms:?&body=${encodeURIComponent(message)}`}><MessageSquare className="size-4" aria-hidden />Text it</a>
          <a className="sk-secondary-button" href={`mailto:?subject=${encodeURIComponent(`Your home: ${propertyAddress}`)}&body=${encodeURIComponent(message)}`}><Mail className="size-4" aria-hidden />Email it</a>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="ox-portal-form">
      <label className="sk-field"><span className="sk-label">For</span>
        <input name="audience" className="sk-input" defaultValue={defaultAudience} maxLength={80} required />
      </label>
      <label className="sk-field"><span className="sk-label">Link stays open</span>
        <select name="days" className="sk-input" defaultValue="60">
          {PORTAL_EXPIRY_CHOICES.map((days) => <option key={days} value={days}>{days} days</option>)}
        </select>
      </label>
      <div className="ox-portal-form-submit"><Submit /></div>
      {state.status === 'error' ? <p role="alert" className="text-sm text-hot sm:col-span-3">{state.message}</p> : null}
    </form>
  );
}
