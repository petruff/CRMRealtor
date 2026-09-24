'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Check, Clock, MessageSquare, Pencil, Send, Sparkles, X } from 'lucide-react';
import type { MarkSentResult } from '@/app/ready-to-send-actions';
import type { ReadyItem } from '@/lib/application/ready-to-send';
import { quickTextHref } from '@/lib/domain/quick-texts';
import { Avatar } from './ui';

type MarkSent = (contactId: string, body: string) => Promise<MarkSentResult>;

const KIND_LABEL: Record<ReadyItem['kind'], string> = {
  'new-lead': 'New lead', 'follow-up': 'Follow-up', birthday: 'Birthday', homeaversary: 'Home anniversary', 'seller-update': 'Seller update',
};

function skipKey(day: string): string {
  return `omnix-ready-skipped-${day}`;
}

function readSkipped(day: string): Set<string> {
  try { return new Set(JSON.parse(window.localStorage.getItem(skipKey(day)) ?? '[]') as string[]); } catch { return new Set(); }
}

export function ReadyRow({ item, onDone, onSkip, markSent }: { item: ReadyItem; onDone: () => void; onSkip: () => void; markSent: MarkSent }) {
  const [body, setBody] = useState(item.body);
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const href = quickTextHref(item.phone, body) ?? item.href;
  return (
    <li className={`ox-ready-row${opened ? ' is-opened' : ''}`}>
      <div className="flex items-start gap-3">
        <Avatar initials={item.initials} leadType={item.leadType} relationship={item.relationship} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/contacts/${encodeURIComponent(item.contactId)}`} className="ox-focus-name">{item.name}</Link>
            <span className="ox-ready-kind">{KIND_LABEL[item.kind]}</span>
          </div>
          <p className="ox-focus-why">{item.reason}</p>
          {item.hint ? <p className="ox-ready-hint"><Clock className="size-3" aria-hidden /> {item.hint}</p> : null}
        </div>
      </div>
      {editing ? (
        <textarea aria-label={`Message to ${item.name}`} value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={1000} className="sk-input mt-3 resize-y text-sm" />
      ) : (
        <p className="ox-ready-draft">{body}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!opened ? (
          <a href={href} className="omnix-chip-action is-primary" onClick={() => setOpened(true)}><Send className="size-3.5" aria-hidden /> Send in Messages</a>
        ) : (
          <button type="button" className={`omnix-chip-action is-primary${pending ? ' ox-busy' : ''}`} disabled={pending} onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await markSent(item.contactId, body);
              if (result.status === 'sent') onDone(); else setError(result.message ?? 'That couldn’t be saved.');
            });
          }}><Check className="size-3.5" aria-hidden /> {pending ? 'Saving…' : 'Mark sent'}</button>
        )}
        {opened ? <a href={href} className="omnix-chip-action"><MessageSquare className="size-3.5" aria-hidden /> Open again</a> : null}
        <button type="button" className="omnix-chip-action" onClick={() => setEditing((value) => !value)}><Pencil className="size-3.5" aria-hidden /> {editing ? 'Done editing' : 'Edit'}</button>
        <button type="button" className="omnix-chip-action" onClick={onSkip} aria-label={`Skip ${item.name} for today`}><X className="size-3.5" aria-hidden /> Skip</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs text-hot">{error}</p> : null}
    </li>
  );
}

/**
 * Today's prepared texts. Sending always happens in her own Messages app;
 * "Mark sent" logs the conversation and moves the follow-up forward.
 * Skips are remembered on this device for today only.
 */
export function ReadyToSend({ items, day, markSent }: { items: readonly ReadyItem[]; day: string; markSent: MarkSent }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(0);
  useEffect(() => { setHidden(readSkipped(day)); }, [day]);
  const visible = useMemo(() => items.filter((item) => !hidden.has(item.id)), [items, hidden]);
  if (!items.length) return null;

  const hide = (id: string, remember: boolean) => {
    setHidden((current) => {
      const next = new Set(current); next.add(id);
      if (remember) { try { window.localStorage.setItem(skipKey(day), JSON.stringify([...next])); } catch { /* storage unavailable */ } }
      return next;
    });
  };

  return (
    <section className="ox-card ox-ready" aria-labelledby="ready-title">
      <header className="ox-card-header">
        <span className="ox-icon-chip ox-tone-reply"><Sparkles className="size-4" aria-hidden /></span>
        <h2 id="ready-title" className="ox-card-title">Ready to send</h2>
        <span className="ox-count" aria-label={`${visible.length} texts ready`}>{visible.length}</span>
      </header>
      {visible.length ? (
        <>
          <p className="px-5 pb-2 text-sm text-muted">Omnix prepared today’s texts from what you’ve saved. Review, send from your phone, and tap Mark sent.</p>
          <ul className="ox-ready-list">
            {visible.map((item) => (
              <ReadyRow key={item.id} item={item} markSent={markSent}
                onDone={() => { setSent((count) => count + 1); hide(item.id, true); }}
                onSkip={() => hide(item.id, true)} />
            ))}
          </ul>
        </>
      ) : (
        <p className="ox-card-empty" role="status"><Check className="size-4 text-accent" aria-hidden /> {sent ? `All caught up — ${sent} sent today. Nice work.` : 'All caught up for today.'}</p>
      )}
    </section>
  );
}
