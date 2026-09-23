'use client';

import { useActionState, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, PhoneCall, X } from 'lucide-react';
import type { CallLogState } from '@/app/calls/actions';
import { VoiceDictation } from '@/components/voice-dictation';
import {
  CALL_OUTCOMES, CALL_OUTCOME_LABEL, CALL_PROMPT_PREFERENCE_KEY, DEFAULT_FOLLOW_UP, PENDING_CALL_KEY,
  shouldPromptForCall, type CallOutcome, type PendingCall,
} from '@/lib/application/call-outcome';

type LogCall = (contactId: string, state: CallLogState, formData: FormData) => Promise<CallLogState>;

const FOLLOW_UPS = [
  { value: 'cadence', label: 'Usual rhythm' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'three-days', label: 'In 3 days' },
  { value: 'next-week', label: 'Next week' },
  { value: 'two-weeks', label: 'In 2 weeks' },
] as const;

function readPending(): PendingCall | undefined {
  try {
    const raw = window.sessionStorage.getItem(PENDING_CALL_KEY);
    return raw ? JSON.parse(raw) as PendingCall : undefined;
  } catch { return undefined; }
}
function writePending(value: PendingCall | undefined) {
  try {
    if (value) window.sessionStorage.setItem(PENDING_CALL_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(PENDING_CALL_KEY);
  } catch { /* storage unavailable */ }
}
export function callPromptEnabled(): boolean {
  try { return window.localStorage.getItem(CALL_PROMPT_PREFERENCE_KEY) !== 'off'; } catch { return false; }
}

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" className={`sk-primary-button${pending ? ' ox-busy' : ''}`} disabled={pending}>{pending ? 'Saving…' : 'Save to timeline'}</button>;
}

function CallLogForm({ call, action, onDone }: { call: PendingCall; action: LogCall; onDone: () => void }) {
  const [state, formAction] = useActionState(action.bind(null, call.contactId), { status: 'idle' } as CallLogState);
  const [outcome, setOutcome] = useState<CallOutcome>('talked');
  const [followUp, setFollowUp] = useState<string>(DEFAULT_FOLLOW_UP.talked);
  const noteId = useId();

  useEffect(() => {
    if (state.status !== 'saved') return;
    const timer = window.setTimeout(onDone, 1400);
    return () => window.clearTimeout(timer);
  }, [state, onDone]);

  if (state.status === 'saved') {
    return <p className="ox-call-saved" role="status"><CheckCircle2 className="size-5" aria-hidden /> Saved to {call.name.split(' ')[0]}’s timeline.</p>;
  }

  return (
    <form action={formAction} className="ox-call-form">
      <fieldset className="ox-chip-group">
        <legend className="sk-label">How did it go?</legend>
        <div className="ox-chips">
          {CALL_OUTCOMES.map((value) => (
            <label key={value} className="ox-chip">
              <input type="radio" name="outcome" value={value} checked={outcome === value}
                onChange={() => { setOutcome(value); setFollowUp(DEFAULT_FOLLOW_UP[value]); }} />
              <span>{CALL_OUTCOME_LABEL[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="sk-field">
        <span className="sk-label">Anything to remember? <span className="font-normal text-subtle">(optional)</span></span>
        <textarea id={noteId} name="note" rows={3} maxLength={2000} className="sk-input resize-y" placeholder="Wants to see Bayshore on Saturday…" />
      </label>
      <VoiceDictation targetId={noteId} label="Dictate a note" />
      <fieldset className="ox-chip-group">
        <legend className="sk-label">Next follow-up</legend>
        <div className="ox-chips">
          {FOLLOW_UPS.map((option) => (
            <label key={option.value} className="ox-chip">
              <input type="radio" name="followUp" value={option.value} checked={followUp === option.value} onChange={() => setFollowUp(option.value)} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {state.status === 'error' ? <p role="alert" className="text-sm text-hot">{state.message}</p> : null}
      <div className="ox-call-actions"><Save /></div>
    </form>
  );
}

/**
 * After the realtor taps Call and comes back to Omnix, offer a 5-second way
 * to log the call. Nothing is saved unless she chooses to, and she can turn
 * the prompt off for this device.
 */
export function CallFollowUp({ action }: { action: LogCall }) {
  const [call, setCall] = useState<PendingCall>();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const maybePrompt = useCallback(() => {
    const pending = readPending();
    if (!pending) return;
    if (!callPromptEnabled()) { writePending(undefined); return; }
    if (shouldPromptForCall(pending, Date.now())) { writePending(undefined); setCall(pending); }
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[data-call-contact]');
      if (!(link instanceof HTMLAnchorElement) || !callPromptEnabled()) return;
      writePending({ contactId: link.dataset.callContact ?? '', name: link.dataset.callName ?? 'this contact', startedAt: Date.now() });
    };
    const onLeave = () => { const pending = readPending(); if (pending && !pending.left) writePending({ ...pending, left: true }); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onLeave(); else maybePrompt(); };
    // A phone may reload the page while the call is on: treat that as having left.
    const pending = readPending();
    if (pending && !pending.left && Date.now() - pending.startedAt > 5_000) { writePending({ ...pending, left: true }); }
    maybePrompt();
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onLeave);
    window.addEventListener('focus', maybePrompt);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('focus', maybePrompt);
    };
  }, [maybePrompt]);

  useEffect(() => {
    if (!call) return;
    panelRef.current?.querySelector<HTMLElement>('input[name="outcome"]:checked, input[name="outcome"]')?.focus();
  }, [call]);

  const close = useCallback(() => setCall(undefined), []);
  if (!call) return null;

  const turnOff = () => {
    try { window.localStorage.setItem(CALL_PROMPT_PREFERENCE_KEY, 'off'); } catch { /* storage unavailable */ }
    close();
  };

  return (
    <div className="ox-sheet-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="ox-sheet ox-call-sheet"
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
        <span className="ox-sheet-grabber" aria-hidden />
        <div className="ox-sheet-header">
          <div className="flex min-w-0 items-center gap-3">
            <span className="ox-icon-chip ox-tone-reply"><PhoneCall className="size-4" aria-hidden /></span>
            <div className="min-w-0">
              <p className="ox-eyebrow">Log this call?</p>
              <h2 id={titleId} className="ox-sheet-title">Your call with {call.name}</h2>
            </div>
          </div>
          <button type="button" className="sk-icon-button" onClick={close} aria-label="Not now"><X className="size-5" aria-hidden /></button>
        </div>
        <CallLogForm call={call} action={action} onDone={close} />
        <button type="button" className="ox-call-off" onClick={turnOff}>Don’t ask after calls on this device</button>
      </div>
    </div>
  );
}
