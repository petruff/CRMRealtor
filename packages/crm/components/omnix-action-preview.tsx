'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ArrowUpRight, CalendarPlus, Check, Copy, MessageSquare, NotebookPen, Phone, UserRound } from 'lucide-react';
import type { OmnixActionPreview } from '@/lib/application/omnix-assistant-actions';

export interface OmnixActionConfirmResult {
  readonly status: 'idle' | 'saved' | 'error';
  readonly message?: string;
  readonly href?: string;
}

export type OmnixConfirmAction = (payload: unknown) => Promise<OmnixActionConfirmResult>;

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/gu, '')}`;
}

function smsHref(phone: string): string {
  return `sms:${phone.replace(/[^\d+]/gu, '')}`;
}

/** Call / Text / Open for a person named in an answer. */
export function OmnixPersonActions({ person }: { person: { id: string; name: string; firstName: string; phone?: string } }) {
  return (
    <div className="omnix-person-actions">
      {person.phone ? (
        <>
          <a href={telHref(person.phone)} data-call-contact={person.id} data-call-name={person.name} className="omnix-chip-action is-primary" aria-label={`Call ${person.name}`}>
            <Phone className="size-3.5" aria-hidden /> Call
          </a>
          <a href={smsHref(person.phone)} className="omnix-chip-action" aria-label={`Text ${person.name}`}>
            <MessageSquare className="size-3.5" aria-hidden /> Text
          </a>
        </>
      ) : null}
      <Link href={`/contacts/${encodeURIComponent(person.id)}`} className="omnix-chip-action" aria-label={`Open ${person.name}`}>
        <UserRound className="size-3.5" aria-hidden /> Open
      </Link>
    </div>
  );
}

function DraftTexts({ preview }: { preview: Extract<OmnixActionPreview, { type: 'draft-text' }> }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (kind: string, body: string) => {
    try { await navigator.clipboard.writeText(body); setCopied(kind); window.setTimeout(() => setCopied(null), 1600); } catch { setCopied(null); }
  };
  return (
    <ul className="mt-3 grid gap-2" aria-label={`Texts for ${preview.person.name}`}>
      {preview.drafts.map((draft) => (
        <li key={draft.kind} className={`omnix-draft${draft.recommended ? ' is-recommended' : ''}`}>
          <p className="text-xs font-semibold text-ink">{draft.label}{draft.recommended ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">Best fit</span> : null}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{draft.body}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.href ? (
              <a href={draft.href} className="omnix-chip-action is-primary"><MessageSquare className="size-3.5" aria-hidden /> Open in Messages</a>
            ) : null}
            <button type="button" className="omnix-chip-action" onClick={() => copy(draft.kind, draft.body)}>
              {copied === draft.kind ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{copied === draft.kind ? 'Copied' : 'Copy'}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SaveButton({ pending, label }: { pending: boolean; label: string }) {
  return <button type="submit" className={`sk-primary-button text-sm${pending ? ' ox-busy' : ''}`} disabled={pending}>{pending ? 'Saving…' : label}</button>;
}

function Saved({ result }: { result: OmnixActionConfirmResult }) {
  return (
    <p role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
      <Check className="size-4 text-accent" aria-hidden /> {result.message}
      {result.href ? <Link href={result.href} className="inline-flex items-center gap-1 text-accent hover:underline">Open <ArrowUpRight className="size-3.5" aria-hidden /></Link> : null}
    </p>
  );
}

function TaskForm({ preview, confirm }: { preview: Extract<OmnixActionPreview, { type: 'create-task' }>; confirm: OmnixConfirmAction }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<OmnixActionConfirmResult>({ status: 'idle' });
  if (result.status === 'saved') return <Saved result={result} />;
  return (
    <form
      className="omnix-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          setResult(await confirm({ type: 'create-task', contactId: preview.person.id, title: data.get('title'), dueDate: data.get('dueDate'), dueTime: data.get('dueTime') }));
        });
      }}
    >
      <label className="sk-field"><span className="sk-label">Follow-up</span>
        <input name="title" defaultValue={preview.title} maxLength={160} required className="sk-input" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="sk-field"><span className="sk-label">Date</span><input name="dueDate" type="date" defaultValue={preview.dueDate} required className="sk-input" /></label>
        <label className="sk-field"><span className="sk-label">Time</span><input name="dueTime" type="time" defaultValue={preview.dueTime} required className="sk-input" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton pending={pending} label="Save follow-up" />
        <span className="text-xs text-muted">{preview.dueLabel} · for {preview.person.name}</span>
      </div>
      {result.status === 'error' ? <p role="alert" className="text-sm text-hot">{result.message}</p> : null}
    </form>
  );
}

function NoteForm({ preview, confirm }: { preview: Extract<OmnixActionPreview, { type: 'log-note' }>; confirm: OmnixConfirmAction }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<OmnixActionConfirmResult>({ status: 'idle' });
  if (result.status === 'saved') return <Saved result={result} />;
  return (
    <form
      className="omnix-action-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          setResult(await confirm({ type: 'log-note', contactId: preview.person.id, body: data.get('body') }));
        });
      }}
    >
      <label className="sk-field"><span className="sk-label">Note for {preview.person.name}</span>
        <textarea name="body" defaultValue={preview.body} rows={3} maxLength={5000} required className="sk-input resize-y" />
      </label>
      <div><SaveButton pending={pending} label="Save note" /></div>
      {result.status === 'error' ? <p role="alert" className="text-sm text-hot">{result.message}</p> : null}
    </form>
  );
}

export function OmnixActionPreviewCard({ preview, confirm, onChooseContact }: {
  preview: OmnixActionPreview;
  confirm: OmnixConfirmAction;
  onChooseContact: (contact: { id: string; name: string }) => void;
}) {
  if (preview.type === 'need-contact') return null;
  if (preview.type === 'choose-contact') {
    return (
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Choose a contact">
        {preview.candidates.map((candidate) => (
          <button key={candidate.id} type="button" className="sk-secondary-button min-h-11 text-xs" onClick={() => onChooseContact({ id: candidate.id, name: candidate.name })}>
            {candidate.name}{candidate.detail ? <span className="text-subtle"> · {candidate.detail}</span> : null}
          </button>
        ))}
      </div>
    );
  }
  const Icon = preview.type === 'draft-text' ? MessageSquare : preview.type === 'create-task' ? CalendarPlus : NotebookPen;
  return (
    <section className="omnix-action-card" aria-label={preview.type === 'draft-text' ? 'Draft texts' : preview.type === 'create-task' ? 'New follow-up' : 'New note'}>
      <header className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent"><Icon className="size-3.5" aria-hidden /></span>
        <p className="text-sm font-semibold text-ink">{preview.person.name}</p>
      </header>
      {preview.type === 'draft-text' ? <DraftTexts preview={preview} /> : null}
      {preview.type === 'create-task' ? <TaskForm preview={preview} confirm={confirm} /> : null}
      {preview.type === 'log-note' ? <NoteForm preview={preview} confirm={confirm} /> : null}
    </section>
  );
}
