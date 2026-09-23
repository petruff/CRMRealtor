'use client';

import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2 } from 'lucide-react';
import type { LeadPageState } from '@/app/l/[key]/actions';
import {
  LEAD_PAGE_EMAIL_CONSENT_TEXT, LEAD_PAGE_HELP, LEAD_PAGE_INTENTS, LEAD_PAGE_SMS_CONSENT_TEXT, LEAD_PAGE_TIMEFRAMES,
} from '@/lib/domain/lead-page';

type SubmitLead = (state: LeadPageState, formData: FormData) => Promise<LeadPageState>;

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" className={`sk-primary-button ox-lead-submit${pending ? ' ox-busy' : ''}`} disabled={pending}>{pending ? 'Sending…' : 'Send'}</button>;
}

function Field({ name, label, state, type = 'text', autoComplete, inputMode, optional = false }: {
  name: string; label: string; state: LeadPageState; type?: string; autoComplete?: string; optional?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  const id = useId();
  const error = state.fieldErrors?.[name];
  return (
    <div className="sk-field">
      <label htmlFor={id} className="sk-label">{label}{optional ? <span className="font-normal text-subtle"> (optional)</span> : null}</label>
      <input id={id} name={name} type={type} autoComplete={autoComplete} inputMode={inputMode} defaultValue={state.values?.[name]}
        className="sk-input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
      {error ? <span id={`${id}-error`} className="sk-error">{error}</span> : null}
    </div>
  );
}

/** Public "Let's talk" form. Consent boxes start unchecked; nothing is pre-selected on the visitor's behalf. */
export function LeadPageForm({ action, agentFirstName, source }: { action: SubmitLead; agentFirstName: string; source?: string }) {
  const [state, formAction] = useActionState(action, { status: 'idle' } as LeadPageState);
  const messageId = useId();

  if (state.status === 'sent') {
    return (
      <section className="ox-portal-hero is-closed" role="status" aria-live="polite">
        <span className="ox-portal-hero-icon"><CheckCircle2 className="size-6" aria-hidden /></span>
        <h1>Thanks, {state.firstName}!</h1>
        <p className="ox-portal-subline">{agentFirstName.charAt(0).toUpperCase() + agentFirstName.slice(1)} will be in touch shortly.</p>
      </section>
    );
  }

  return (
    <form action={formAction} className="ox-card ox-lead-form" noValidate>
      <div className="ox-lead-grid">
        <Field name="firstName" label="First name" autoComplete="given-name" state={state} />
        <Field name="lastName" label="Last name" autoComplete="family-name" state={state} />
        <Field name="phone" label="Mobile phone" type="tel" autoComplete="tel" inputMode="tel" state={state} optional />
        <Field name="email" label="Email" type="email" autoComplete="email" inputMode="email" state={state} optional />
      </div>
      <fieldset className="ox-chip-group">
        <legend className="sk-label">How can {agentFirstName} help?</legend>
        <div className="ox-chips">
          {LEAD_PAGE_HELP.map((item) => (
            <label key={item.value} className="ox-chip"><input type="radio" name="help" value={item.value} defaultChecked={(state.values?.help ?? 'general-inquiry') === item.value} /><span>{item.label}</span></label>
          ))}
        </div>
      </fieldset>
      <fieldset className="ox-chip-group">
        <legend className="sk-label">I’m looking to</legend>
        <div className="ox-chips">
          {LEAD_PAGE_INTENTS.map((item) => (
            <label key={item.value} className="ox-chip"><input type="radio" name="intent" value={item.value} defaultChecked={state.values?.intent === item.value} /><span>{item.label}</span></label>
          ))}
        </div>
      </fieldset>
      <fieldset className="ox-chip-group">
        <legend className="sk-label">When?</legend>
        <div className="ox-chips">
          {LEAD_PAGE_TIMEFRAMES.map((item) => (
            <label key={item.value} className="ox-chip"><input type="radio" name="timeframe" value={item.value} defaultChecked={state.values?.timeframe === item.value} /><span>{item.label}</span></label>
          ))}
        </div>
      </fieldset>
      <div className="sk-field">
        <label htmlFor={messageId} className="sk-label">Anything {agentFirstName} should know? <span className="font-normal text-subtle">(optional)</span></label>
        <textarea id={messageId} name="message" rows={3} maxLength={1500} defaultValue={state.values?.message} className="sk-input resize-y" placeholder="Neighborhoods, budget, a home you saw…" />
      </div>
      <div className="ox-lead-consents">
        <label className="ox-toggle-row"><input type="checkbox" name="smsConsent" defaultChecked={state.values?.smsConsent === 'on'} /><span><strong>Text me</strong><small>{LEAD_PAGE_SMS_CONSENT_TEXT}</small></span></label>
        {state.fieldErrors?.smsConsent ? <p className="sk-error">{state.fieldErrors.smsConsent}</p> : null}
        <label className="ox-toggle-row"><input type="checkbox" name="emailConsent" defaultChecked={state.values?.emailConsent === 'on'} /><span><strong>Email me</strong><small>{LEAD_PAGE_EMAIL_CONSENT_TEXT}</small></span></label>
        {state.fieldErrors?.emailConsent ? <p className="sk-error">{state.fieldErrors.emailConsent}</p> : null}
      </div>
      <input type="hidden" name="src" value={source ?? ''} />
      <div className="sr-only" aria-hidden><label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label></div>
      {state.status === 'error' && state.message ? <p role="alert" className="text-sm font-medium text-hot">{state.message}</p> : null}
      <Submit />
      <p className="ox-lead-privacy">Your details go only to {agentFirstName} and are never sold.</p>
    </form>
  );
}
