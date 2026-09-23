'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Home, LogOut } from 'lucide-react';
import type { OpenHouseSignInState } from '@/app/open-house/kiosk/actions';
import {
  OPEN_HOUSE_EMAIL_CONSENT_TEXT, OPEN_HOUSE_SMS_CONSENT_TEXT, OPEN_HOUSE_TIMEFRAMES, OPEN_HOUSE_TIMEFRAME_LABEL,
} from '@/lib/domain/open-house';

type SignInAction = (state: OpenHouseSignInState, formData: FormData) => Promise<OpenHouseSignInState>;

export const KIOSK_PIN_KEY = 'omnix-open-house-pin';
const RESET_SECONDS = 8;

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="sk-primary-button ox-kiosk-submit">{pending ? 'Signing you in…' : 'Sign in'}</button>;
}

function Field({ name, label, type = 'text', autoComplete, state, required = false, inputMode }: {
  name: string; label: string; type?: string; autoComplete?: string; state: OpenHouseSignInState; required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const id = useId();
  const error = state.fieldErrors?.[name];
  return (
    <div className="sk-field">
      <label htmlFor={id} className="sk-label">{label}{required ? null : <span className="font-normal text-subtle"> (optional)</span>}</label>
      <input id={id} name={name} type={type} autoComplete={autoComplete} inputMode={inputMode} defaultValue={state.values?.[name]}
        className="sk-input ox-kiosk-input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
      {error ? <span id={`${id}-error`} className="sk-error">{error}</span> : null}
    </div>
  );
}

/**
 * Tablet sign-in for open houses. Runs on the realtor's signed-in device in a
 * chrome-less layout; visitors never see CRM data. A staff PIN (kept only in
 * this browser tab) guards the exit so a guest can't wander into the CRM.
 */
export function OpenHouseKiosk({ property, hostName, action }: { property: string; hostName?: string; action: SignInAction }) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, { status: 'idle' } as OpenHouseSignInState);
  const [thanks, setThanks] = useState<string>();
  const [countdown, setCountdown] = useState(RESET_SECONDS);
  const [exiting, setExiting] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string>();

  useEffect(() => {
    if (state.status !== 'success') return;
    setThanks(state.firstName);
    setCountdown(RESET_SECONDS);
  }, [state]);

  useEffect(() => {
    if (!thanks) return;
    if (countdown <= 0) { setThanks(undefined); return; }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [thanks, countdown]);

  const tryExit = (event: React.FormEvent) => {
    event.preventDefault();
    let expected: string | null = null;
    try { expected = sessionStorage.getItem(KIOSK_PIN_KEY); } catch { expected = null; }
    if (!expected || expected === pin) {
      try { sessionStorage.removeItem(KIOSK_PIN_KEY); } catch { /* storage unavailable */ }
      router.push('/open-house');
      return;
    }
    setPinError('That PIN doesn’t match.');
  };

  return (
    <div className="ox-kiosk">
      <header className="ox-kiosk-header">
        <span className="ox-kiosk-home"><Home className="size-5" aria-hidden /></span>
        <div className="min-w-0">
          <p className="ox-eyebrow">Open house</p>
          <p className="ox-kiosk-property">{property}</p>
        </div>
        <button type="button" className="ox-kiosk-exit" onClick={() => setExiting((value) => !value)} aria-expanded={exiting} aria-controls="kiosk-exit">
          <LogOut className="size-4" aria-hidden /> Staff
        </button>
      </header>
      {exiting ? (
        <form id="kiosk-exit" className="ox-card ox-kiosk-exit-panel" onSubmit={tryExit}>
          <label className="sk-field"><span className="sk-label">Staff PIN to exit</span>
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => { setPin(event.target.value); setPinError(undefined); }} className="sk-input" autoFocus />
          </label>
          {pinError ? <p role="alert" className="text-sm text-hot">{pinError}</p> : null}
          <button type="submit" className="sk-secondary-button">Exit sign-in</button>
        </form>
      ) : null}

      {thanks ? (
        <section className="ox-kiosk-thanks" role="status" aria-live="polite">
          <span className="ox-empty-hero-icon"><CheckCircle2 className="size-8" aria-hidden /></span>
          <h1>Thanks, {thanks}!</h1>
          <p>Enjoy the tour{hostName ? ` — ${hostName} will be glad to answer any questions` : ''}.</p>
          <button type="button" className="sk-secondary-button" onClick={() => setThanks(undefined)}>Next guest ({countdown})</button>
        </section>
      ) : (
        <form key={state.submissionKey ?? 'kiosk'} action={formAction} className="ox-card ox-kiosk-form" noValidate>
          <div>
            <h1 className="ox-kiosk-title">Welcome! Please sign in.</h1>
            <p className="ox-kiosk-subtitle">{hostName ? `Hosted by ${hostName}. ` : ''}Your details stay with this agent and are never sold.</p>
          </div>
          <div className="ox-kiosk-grid">
            <Field name="firstName" label="First name" autoComplete="given-name" state={state} required />
            <Field name="lastName" label="Last name" autoComplete="family-name" state={state} required />
            <Field name="phone" label="Mobile phone" type="tel" autoComplete="tel" inputMode="tel" state={state} />
            <Field name="email" label="Email" type="email" autoComplete="email" inputMode="email" state={state} />
          </div>
          <fieldset className="ox-chip-group">
            <legend className="sk-label">I’m looking to</legend>
            <div className="ox-chips">
              {([['buyer', 'Buy'], ['seller', 'Sell'], ['both', 'Buy & sell'], ['renter', 'Rent'], ['investor', 'Invest']] as const).map(([value, label]) => (
                <label key={value} className="ox-chip"><input type="radio" name="intent" value={value} defaultChecked={(state.values?.intent ?? 'buyer') === value} /><span>{label}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset className="ox-chip-group">
            <legend className="sk-label">When?</legend>
            <div className="ox-chips">
              {OPEN_HOUSE_TIMEFRAMES.map((value) => (
                <label key={value} className="ox-chip"><input type="radio" name="timeframe" value={value} defaultChecked={(state.values?.timeframe ?? 'just-looking') === value} /><span>{OPEN_HOUSE_TIMEFRAME_LABEL[value]}</span></label>
              ))}
            </div>
          </fieldset>
          <fieldset className="ox-chip-group">
            <legend className="sk-label">Are you working with a real estate agent?</legend>
            <div className="ox-chips">
              <label className="ox-chip"><input type="radio" name="hasAgent" value="no" defaultChecked={(state.values?.hasAgent ?? 'no') === 'no'} /><span>No</span></label>
              <label className="ox-chip"><input type="radio" name="hasAgent" value="yes" defaultChecked={state.values?.hasAgent === 'yes'} /><span>Yes</span></label>
            </div>
          </fieldset>
          <div className="ox-kiosk-consents">
            <label className="ox-toggle-row"><input type="checkbox" name="smsConsent" defaultChecked={state.values?.smsConsent === 'on'} /><span><strong>Text me</strong><small>{OPEN_HOUSE_SMS_CONSENT_TEXT}</small></span></label>
            {state.fieldErrors?.smsConsent ? <p className="sk-error">{state.fieldErrors.smsConsent}</p> : null}
            <label className="ox-toggle-row"><input type="checkbox" name="emailConsent" defaultChecked={state.values?.emailConsent === 'on'} /><span><strong>Email me</strong><small>{OPEN_HOUSE_EMAIL_CONSENT_TEXT}</small></span></label>
            {state.fieldErrors?.emailConsent ? <p className="sk-error">{state.fieldErrors.emailConsent}</p> : null}
          </div>
          <div className="sr-only" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          {state.status === 'error' && state.message ? <p role="alert" className="text-sm font-medium text-hot">{state.message}</p> : null}
          <Submit />
        </form>
      )}
    </div>
  );
}
