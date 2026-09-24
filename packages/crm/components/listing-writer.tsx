'use client';

import { startTransition, useActionState, useEffect, useId, useState } from 'react';
import { AlertTriangle, Check, Copy, Mail, MessageSquare, PenLine, Sparkles } from 'lucide-react';
import type { ListingWriterState } from '@/app/listing-writer/actions';
import { fairHousingCategoryLabel } from '@/lib/domain/fair-housing';
import { LISTING_FORMAT_LABEL, LISTING_FORMATS, LISTING_HOME_TYPES, type ListingFormat } from '@/lib/domain/listing-writer';
import { FairHousingCheck } from './fair-housing-check';
import { VoiceDictation } from './voice-dictation';

type WriteAction = (state: ListingWriterState, formData: FormData) => Promise<ListingWriterState>;

export interface ListingPrefill {
  readonly address?: string;
  readonly city?: string;
  readonly homeType?: (typeof LISTING_HOME_TYPES)[number];
  readonly beds?: number;
  readonly baths?: number;
  readonly squareFeet?: number;
  readonly price?: number;
  readonly yearBuilt?: number;
}

function WriteButton({ format, active, pending }: { format: ListingFormat; active: boolean; pending: ListingFormat | null }) {
  const mine = pending === format;
  return (
    <button type="submit" name="format" value={format} disabled={pending !== null}
      className={`ox-listing-format${active ? ' is-active' : ''}${mine ? ' ox-busy' : ''}`} aria-pressed={active}>
      {mine ? 'Writing…' : LISTING_FORMAT_LABEL[format]}
    </button>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`sk-field${wide ? ' sm:col-span-2' : ''}`}><span className="sk-label">{label}</span>{children}</label>;
}

/** Facts in, ready-to-post copy out. Nothing is published from here. */
export function ListingWriter({ action, prefill, agentName }: { action: WriteAction; prefill?: ListingPrefill; agentName?: string }) {
  const [state, formAction, isPending] = useActionState(action, { status: 'idle' } as ListingWriterState);
  const [requested, setRequested] = useState<ListingFormat | null>(null);
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [results, setResults] = useState<Partial<Record<string, Extract<ListingWriterState, { status: 'written' }>>>>({});
  const [active, setActive] = useState<ListingFormat>('mls');
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const highlightsId = useId();

  useEffect(() => {
    if (state.status !== 'written') return;
    const format = state.format as ListingFormat;
    setResults((current) => ({ ...current, [`${format}:${state.language}`]: state }));
    setActive(format);
    setDraft(state.text);
  }, [state]);

  const current = results[`${active}:${language}`];
  useEffect(() => { setDraft(current?.text ?? ''); setCopied(false); }, [current]);

  const copy = async () => { try { await navigator.clipboard.writeText(draft); setCopied(true); } catch { setCopied(false); } };
  const subject = draft.match(/^(?:Subject|Asunto):\s*(.+)$/mu)?.[1];
  const emailBody = draft.replace(/^(?:Subject|Asunto):.*\n+/mu, '');

  return (
    // Submitted by hand so the facts stay in the form between formats (a form action would reset it).
    <form className="grid gap-4" onSubmit={(event) => {
      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      const data = new FormData(event.currentTarget);
      const format = (submitter?.value ?? 'mls') as ListingFormat;
      data.set('format', format);
      setRequested(format);
      startTransition(() => formAction(data));
    }}>
      <section className="ox-card ox-listing-facts" aria-labelledby="listing-facts-title">
        <header className="ox-card-header">
          <span className="ox-icon-chip ox-tone-reply"><PenLine className="size-4" aria-hidden /></span>
          <h2 id="listing-facts-title" className="ox-card-title">The home</h2>
        </header>
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          <Field label="Address (optional)"><input name="address" defaultValue={prefill?.address} maxLength={120} className="sk-input" /></Field>
          <Field label="City or neighborhood"><input name="city" required defaultValue={prefill?.city} maxLength={60} className="sk-input" /></Field>
          <Field label="Home type">
            <select name="homeType" defaultValue={prefill?.homeType ?? 'single-family home'} className="sk-input">
              {LISTING_HOME_TYPES.map((type) => <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="List price"><input name="price" inputMode="numeric" defaultValue={prefill?.price} placeholder="$650,000" className="sk-input" /></Field>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <Field label="Beds"><input name="beds" inputMode="numeric" defaultValue={prefill?.beds} className="sk-input" /></Field>
            <Field label="Baths"><input name="baths" inputMode="decimal" defaultValue={prefill?.baths} className="sk-input" /></Field>
            <Field label="Sq ft"><input name="squareFeet" inputMode="numeric" defaultValue={prefill?.squareFeet} className="sk-input" /></Field>
          </div>
          <Field label="Year built (optional)"><input name="yearBuilt" inputMode="numeric" defaultValue={prefill?.yearBuilt} className="sk-input" /></Field>
          <Field label="Open house (optional)"><input name="openHouse" maxLength={80} placeholder="Sat 1–4 PM" className="sk-input" /></Field>
          <label className="sk-field sm:col-span-2" htmlFor={highlightsId}>
            <span className="sk-label">Highlights — in your own words</span>
            <textarea id={highlightsId} name="highlights" required rows={4} maxLength={800} className="sk-input resize-y"
              placeholder="Renovated kitchen with quartz counters, heated pool, impact windows, new roof 2023, two-car garage" />
          </label>
          <div className="sm:col-span-2"><VoiceDictation targetId={highlightsId} label="Dictate highlights" /></div>
          <Field label="Location notes (places, not people)" wide><input name="area" maxLength={400} placeholder="10 minutes to the beach, near Dadeland Mall and the Metrorail" className="sk-input" /></Field>
          <input type="hidden" name="language" value={language} />
          {agentName ? <input type="hidden" name="agentName" value={agentName} /> : null}
          <div className="sm:col-span-2"><FairHousingCheck fields={['highlights', 'area']} /></div>
        </div>
      </section>

      <section className="ox-card" aria-labelledby="listing-copy-title">
        <header className="ox-card-header">
          <span className="ox-icon-chip ox-tone-reply"><Sparkles className="size-4" aria-hidden /></span>
          <h2 id="listing-copy-title" className="ox-card-title">Write</h2>
          <div className="ox-segment" role="group" aria-label="Language">
            {(['en', 'es'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>
            ))}
          </div>
        </header>
        <div className="grid gap-3 px-5 pb-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label="What to write">
            {LISTING_FORMATS.map((format) => <WriteButton key={format} format={format} active={active === format && Boolean(current)} pending={isPending ? requested : null} />)}
          </div>
          {state.status === 'error' ? (
            <div role="alert" className="ox-listing-alert">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" aria-hidden /> {state.message}</p>
              {state.findings?.length ? <ul className="mt-2 grid gap-1 text-xs">{state.findings.map((finding) => <li key={`${finding.index}-${finding.phrase}`}>“{finding.phrase}” — {fairHousingCategoryLabel(finding.category)}. {finding.suggestion}</li>)}</ul> : null}
            </div>
          ) : null}
          {current ? (
            <div className="grid gap-2">
              <p className="text-xs text-muted">{LISTING_FORMAT_LABEL[active]} · {language === 'es' ? 'Spanish' : 'English'} · {current.source === 'ai' ? 'Written by Omnix AI from your facts' : current.note ?? 'Built-in template'}</p>
              <textarea aria-label={`${LISTING_FORMAT_LABEL[active]} copy`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={active === 'open-house' ? 3 : 12} className="sk-input resize-y text-sm leading-relaxed" />
              {current.findings.length ? (
                <ul className="ox-listing-alert text-xs">{current.findings.map((finding) => <li key={`${finding.index}-${finding.phrase}`}>Review “{finding.phrase}”: {finding.suggestion}</li>)}</ul>
              ) : <p className="flex items-center gap-1.5 text-xs text-muted"><Check className="size-3.5 text-accent" aria-hidden /> Fair Housing check passed. Always review before posting.</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="omnix-chip-action is-primary" onClick={copy}>{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{copied ? 'Copied' : 'Copy'}</button>
                {active === 'open-house' ? <a className="omnix-chip-action" href={`sms:?&body=${encodeURIComponent(draft)}`}><MessageSquare className="size-3.5" aria-hidden /> Text it</a> : null}
                {active === 'email' ? <a className="omnix-chip-action" href={`mailto:?subject=${encodeURIComponent(subject ?? 'New listing')}&body=${encodeURIComponent(emailBody)}`}><Mail className="size-3.5" aria-hidden /> Open in email</a> : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Pick what to write. You can edit the result before copying it.</p>
          )}
        </div>
      </section>
    </form>
  );
}
