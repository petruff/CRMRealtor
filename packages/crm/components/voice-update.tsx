'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { ArrowRight, Check, Mic, Sparkles } from 'lucide-react';
import type { VoiceApplyResult, VoiceReviewResult } from '@/app/contacts/voice-update-actions';
import type { VoiceUpdateReview } from '@/lib/application/voice-update-commands';
import { VoiceDictation } from './voice-dictation';

type ReviewAction = (contactId: string, text: string) => Promise<VoiceReviewResult>;
type ApplyAction = (input: { contactId: string; text: string; keep: string[]; saveNote: boolean }) => Promise<VoiceApplyResult>;

/**
 * "Voice update": say what happened, review what Omnix understood, save.
 * Budget, beds, areas, pre-approval, timeline, temperature and the next
 * follow-up update in one step; the words are kept as a note.
 */
export function VoiceUpdate({ contactId, firstName, review, apply, initiallyOpen = false }: {
  contactId: string; firstName: string; review: ReviewAction; apply: ApplyAction; initiallyOpen?: boolean;
}) {
  const router = useRouter();
  const textId = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [text, setText] = useState('');
  const [result, setResult] = useState<VoiceUpdateReview | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [saveNote, setSaveNote] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => { setText(''); setResult(null); setKeep(new Set()); setSaveNote(true); };

  return (
    <>
      <button type="button" className="sk-text-action" aria-expanded={open} onClick={() => { setOpen((value) => !value); setMessage(null); }}>
        <Mic className="size-4" aria-hidden /> Voice update
      </button>
      {open ? (
        <section className="ox-voice-update" aria-label={`Voice update for ${firstName}`}>
          {!result ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setMessage(null);
                startTransition(async () => {
                  const reviewed = await review(contactId, text);
                  if (reviewed.status === 'error') { setMessage({ tone: 'error', text: reviewed.message }); return; }
                  setResult(reviewed.review);
                  setKeep(new Set(reviewed.review.changes.map((change) => change.field)));
                });
              }}
            >
              <label htmlFor={textId} className="sk-label">What happened with {firstName}?</label>
              <p className="mt-1 text-xs text-muted">Talk like you would to an assistant: “Pre-approved for 450k, wants 3 beds in Coral Gables, call her Friday.”</p>
              <textarea id={textId} value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={2000} className="sk-input mt-2 resize-y" placeholder="Tap the mic or type…" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <VoiceDictation targetId={textId} onAppend={(spoken) => setText((current) => `${current}${current && !/\s$/u.test(current) ? ' ' : ''}${spoken}`.slice(0, 2000))} label="Speak" />
                <button type="submit" className={`sk-primary-button${pending ? ' ox-busy' : ''}`} disabled={pending || !text.trim()}>
                  {pending ? 'Reading…' : <>Review <ArrowRight className="size-4" aria-hidden /></>}
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const saved = await apply({ contactId, text: result.note, keep: [...keep], saveNote });
                  setMessage({ tone: saved.status === 'saved' ? 'ok' : 'error', text: saved.message });
                  if (saved.status === 'saved') { reset(); router.refresh(); }
                });
              }}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Sparkles className="size-4 text-accent" aria-hidden />
                {result.changes.length ? `Here’s what I’ll update for ${firstName}` : 'I didn’t find details to update — you can still save it as a note.'}
              </p>
              {result.changes.length ? (
                <ul className="mt-3 grid gap-2">
                  {result.changes.map((change) => (
                    <li key={change.field}>
                      <label className="ox-voice-change">
                        <input type="checkbox" checked={keep.has(change.field)} onChange={(event) => setKeep((current) => {
                          const next = new Set(current); if (event.target.checked) next.add(change.field); else next.delete(change.field); return next;
                        })} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{change.label}: {change.before ? <><s className="text-subtle">{change.before}</s> → </> : null}{change.after}</span>
                          <span className="block text-xs text-subtle">From “{change.evidence}”</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
              <label className="ox-voice-change mt-2">
                <input type="checkbox" checked={saveNote} onChange={(event) => setSaveNote(event.target.checked)} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-ink">Save as a note</span><span className="block truncate text-xs text-subtle">{result.note}</span></span>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" className={`sk-primary-button${pending ? ' ox-busy' : ''}`} disabled={pending || (!keep.size && !saveNote)}>{pending ? 'Saving…' : 'Save update'}</button>
                <button type="button" className="sk-secondary-button" onClick={() => setResult(null)} disabled={pending}>Edit words</button>
              </div>
            </form>
          )}
          {message ? <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 flex items-center gap-2 text-sm ${message.tone === 'error' ? 'text-hot' : 'font-medium text-ink'}`}>{message.tone === 'ok' ? <Check className="size-4 text-accent" aria-hidden /> : null}{message.text}</p> : null}
        </section>
      ) : null}
    </>
  );
}
