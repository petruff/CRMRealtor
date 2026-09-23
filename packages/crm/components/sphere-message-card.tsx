'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, Mail, MessageSquare } from 'lucide-react';
import type { SentState } from '@/app/sphere/actions';
import { mailtoHref, smsHref, type DraftLanguage, type MessageDraft } from '@/lib/application/referral-engine';

type MarkSent = (state: SentState, formData: FormData) => Promise<SentState>;

function MarkSentButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="ox-sphere-mark" disabled={pending}><Check className="size-4" aria-hidden />{pending ? 'Saving…' : 'Mark sent'}</button>;
}

/**
 * One personal moment with a ready-to-send draft. Text and email open the
 * realtor's own phone or mail app pre-filled; nothing is sent automatically.
 */
export function SphereMessageCard({ contactId, name, initials, label, kind, phone, email, drafts, action, tone }: {
  contactId: string; name: string; initials: string; label: string; kind: string; phone?: string; email?: string;
  drafts: Readonly<Record<DraftLanguage, MessageDraft>>; action: MarkSent; tone: 'celebrate' | 'quiet' | 'thanks';
}) {
  const [language, setLanguage] = useState<DraftLanguage>('en');
  const [channel, setChannel] = useState<'text' | 'email'>(phone ? 'text' : 'email');
  const [copied, setCopied] = useState(false);
  const [state, formAction] = useActionState(action, { status: 'idle' } as SentState);
  const draft = drafts[language];
  const text = channel === 'text' ? draft.sms : `${draft.emailSubject}\n\n${draft.emailBody}`;
  const sms = smsHref(phone, draft.sms);
  const mail = mailtoHref(email, draft.emailSubject, draft.emailBody);

  const copy = async () => {
    try { await navigator.clipboard.writeText(channel === 'text' ? draft.sms : draft.emailBody); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  };

  return (
    <article className={`ox-sphere-card is-${tone}${state.status === 'sent' ? ' is-sent' : ''}`}>
      <header className="ox-sphere-card-header">
        <span className="ox-sphere-avatar" aria-hidden>{initials}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/contacts/${encodeURIComponent(contactId)}`} className="ox-row-title">{name}</Link>
          <p className="ox-row-detail">{label}</p>
        </div>
        <div className="ox-segment" role="group" aria-label="Draft language">
          {(['en', 'es'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>
          ))}
        </div>
      </header>
      {state.status === 'sent' ? (
        <p className="ox-sphere-sent" role="status"><Check className="size-4" aria-hidden /> Logged — {name.split(' ')[0]}’s next touch is scheduled.</p>
      ) : (
        <>
          <div className="ox-segment is-channel" role="group" aria-label="Channel">
            <button type="button" aria-pressed={channel === 'text'} onClick={() => setChannel('text')}>Text</button>
            <button type="button" aria-pressed={channel === 'email'} onClick={() => setChannel('email')}>Email</button>
          </div>
          <p className="ox-sphere-draft" aria-label="Draft message">{text}</p>
          <div className="ox-sphere-actions">
            {channel === 'text' ? (sms ? <a className="sk-primary-button" href={sms}><MessageSquare className="size-4" aria-hidden />Open in Messages</a> : <span className="ox-sphere-missing">No mobile number on file</span>)
              : (mail ? <a className="sk-primary-button" href={mail}><Mail className="size-4" aria-hidden />Open in Mail</a> : <span className="ox-sphere-missing">No email on file</span>)}
            <button type="button" className="sk-secondary-button" onClick={copy}>{copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied ? 'Copied' : 'Copy'}</button>
            <form action={formAction} className="ml-auto">
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="channel" value={channel} />
              <input type="hidden" name="language" value={language} />
              <MarkSentButton />
            </form>
          </div>
          {state.status === 'error' ? <p role="alert" className="text-sm text-hot">{state.message}</p> : null}
        </>
      )}
    </article>
  );
}
