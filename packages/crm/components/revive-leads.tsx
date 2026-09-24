'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { BellOff, Check, Mail, Pencil, RotateCcw, X } from 'lucide-react';
import type { ReviveResult } from '@/app/revive/actions';
import { reviveMailto, type ReviveItem } from '@/lib/application/revive-leads';
import { Avatar } from './ui';

type MarkSent = (contactId: string, subject: string) => Promise<ReviveResult>;
type StopEmails = (contactId: string) => Promise<ReviveResult>;

const ANGLE_LABEL: Record<ReviveItem['angle'], string> = { seller: 'Home value offer', buyer: 'Home search', general: 'Check-in' };

function skipKey(day: string): string {
  return `omnix-revive-skipped-${day}`;
}

function ReviveRow({ item, markSent, stopEmails, onDone }: { item: ReviveItem; markSent: MarkSent; stopEmails: StopEmails; onDone: (outcome: 'sent' | 'skipped' | 'stopped') => void }) {
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const href = reviveMailto(item.email, subject, body);
  const run = (task: () => Promise<ReviveResult>, outcome: 'sent' | 'stopped') => {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.status === 'done') onDone(outcome); else setError(result.message ?? 'That couldn’t be saved.');
    });
  };
  return (
    <li className={`ox-ready-row${opened ? ' is-opened' : ''}`}>
      <div className="flex items-start gap-3">
        <Avatar initials={item.initials} leadType={item.leadType} relationship="lead" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/contacts/${encodeURIComponent(item.contactId)}`} className="ox-focus-name">{item.name}</Link>
            <span className="ox-ready-kind">{ANGLE_LABEL[item.angle]}</span>
          </div>
          <p className="ox-focus-why">{item.why}</p>
          <p className="ox-ready-hint"><Mail className="size-3" aria-hidden /> {item.email}</p>
        </div>
      </div>
      {editing ? (
        <div className="mt-3 grid gap-2">
          <input aria-label={`Subject for ${item.name}`} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={150} className="sk-input text-sm" />
          <textarea aria-label={`Email to ${item.name}`} value={body} onChange={(event) => setBody(event.target.value)} rows={9} maxLength={3000} className="sk-input resize-y text-sm leading-relaxed" />
        </div>
      ) : (
        <div className="ox-ready-draft">
          <p className="font-semibold text-ink">{subject}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-line">{body}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!opened ? (
          <a href={href} className="omnix-chip-action is-primary" onClick={() => setOpened(true)}><Mail className="size-3.5" aria-hidden /> Open in email</a>
        ) : (
          <button type="button" className={`omnix-chip-action is-primary${pending ? ' ox-busy' : ''}`} disabled={pending}
            onClick={() => run(() => markSent(item.contactId, subject), 'sent')}><Check className="size-3.5" aria-hidden /> {pending ? 'Saving…' : 'Mark sent'}</button>
        )}
        {opened ? <a href={href} className="omnix-chip-action"><Mail className="size-3.5" aria-hidden /> Open again</a> : null}
        <button type="button" className="omnix-chip-action" onClick={() => setEditing((value) => !value)}><Pencil className="size-3.5" aria-hidden /> {editing ? 'Done editing' : 'Edit'}</button>
        <button type="button" className="omnix-chip-action" onClick={() => onDone('skipped')} aria-label={`Skip ${item.name} for today`}><X className="size-3.5" aria-hidden /> Skip</button>
        {!confirmStop ? (
          <button type="button" className="omnix-chip-action" onClick={() => setConfirmStop(true)}><BellOff className="size-3.5" aria-hidden /> Asked to stop</button>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            Turn off email for {item.firstName}?
            <button type="button" className={`omnix-chip-action${pending ? ' ox-busy' : ''}`} disabled={pending} onClick={() => run(() => stopEmails(item.contactId), 'stopped')}>Yes, turn off</button>
            <button type="button" className="omnix-chip-action" onClick={() => setConfirmStop(false)}>Cancel</button>
          </span>
        )}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-hot">{error}</p> : null}
    </li>
  );
}

/**
 * Today's revive batch. Emails open in her own email app; nothing is sent from
 * here. Skips are remembered on this device for today only.
 */
export function ReviveLeads({ items, eligible, day, markSent, stopEmails }: {
  items: readonly ReviveItem[]; eligible: number; day: string; markSent: MarkSent; stopEmails: StopEmails;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(0);
  useEffect(() => {
    try { setHidden(new Set(JSON.parse(window.localStorage.getItem(skipKey(day)) ?? '[]') as string[])); } catch { /* storage unavailable */ }
  }, [day]);
  const visible = useMemo(() => items.filter((item) => !hidden.has(item.contactId)), [items, hidden]);
  const hide = (id: string) => setHidden((current) => {
    const next = new Set(current); next.add(id);
    try { window.localStorage.setItem(skipKey(day), JSON.stringify([...next])); } catch { /* storage unavailable */ }
    return next;
  });

  return (
    <section className="ox-card ox-ready" aria-labelledby="revive-title">
      <header className="ox-card-header">
        <span className="ox-icon-chip ox-tone-reply"><RotateCcw className="size-4" aria-hidden /></span>
        <h2 id="revive-title" className="ox-card-title">Today’s emails</h2>
        <span className="ox-count" aria-label={`${visible.length} emails ready`}>{visible.length}</span>
      </header>
      {visible.length ? (
        <>
          <p className="px-5 pb-2 text-sm text-muted">{eligible} old {eligible === 1 ? 'lead is' : 'leads are'} waiting. Here are today’s {items.length}, sellers with a known home first. Each one opens in your own email app.</p>
          <ul className="ox-ready-list">
            {visible.map((item) => (
              <ReviveRow key={item.contactId} item={item} markSent={markSent} stopEmails={stopEmails}
                onDone={(outcome) => { if (outcome === 'sent') setSent((count) => count + 1); hide(item.contactId); }} />
            ))}
          </ul>
        </>
      ) : (
        <p className="ox-card-empty" role="status"><Check className="size-4 text-accent" aria-hidden /> {items.length ? (sent ? `Done for today — ${sent} sent. Tomorrow’s batch will be ready in the morning.` : 'Done for today. Tomorrow’s batch will be ready in the morning.') : 'No old leads to revive right now.'}</p>
      )}
    </section>
  );
}
