'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight } from 'lucide-react';
import { VoiceDictation } from '@/components/voice-dictation';
import { INITIAL_CONTACT_ACTION_STATE, type ContactActionState } from '@/lib/application/contact-action-state';

type StepAction = (state: ContactActionState, formData: FormData) => Promise<ContactActionState>;

const FOLLOW_UPS = [
  { value: 'cadence', label: 'Usual rhythm' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'three-days', label: 'In 3 days' },
  { value: 'next-week', label: 'Next week' },
  { value: 'two-weeks', label: 'In 2 weeks' },
] as const;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="sk-primary-button ox-power-save">
      {pending ? 'Saving…' : <>Done — next person <ArrowRight className="size-4" aria-hidden /></>}
    </button>
  );
}

export function PowerHourStepForm({
  action,
  sessionDone,
  sessionSkip,
  cadenceLabel,
}: {
  action: StepAction;
  sessionDone: number;
  sessionSkip: string;
  cadenceLabel: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_CONTACT_ACTION_STATE);
  const noteError = state.fieldErrors?.note;
  return (
    <form key={state.values ? JSON.stringify(state.values) : 'step'} action={formAction} className="ox-power-form">
      <input type="hidden" name="sessionDone" value={sessionDone} />
      <input type="hidden" name="sessionSkip" value={sessionSkip} />
      <label className="sk-field">
        <span className="sk-label">What happened? <span className="font-normal text-subtle">(optional)</span></span>
        <textarea
          id="power-hour-note"
          name="note"
          rows={3}
          maxLength={5000}
          defaultValue={state.values?.note}
          placeholder="Left a voicemail · wants to see homes near the water · call back after 5pm"
          className="sk-input resize-y"
          aria-invalid={noteError ? true : undefined}
        />
        {noteError ? <span className="sk-error">{noteError}</span> : null}
      </label>
      <VoiceDictation targetId="power-hour-note" label="Dictate what happened" />
      <fieldset className="ox-chip-group">
        <legend className="sk-label">Next follow-up</legend>
        <div className="ox-chips">
          {FOLLOW_UPS.map((option) => (
            <label key={option.value} className="ox-chip">
              <input type="radio" name="followUp" value={option.value} defaultChecked={(state.values?.followUp ?? 'cadence') === option.value} />
              <span>{option.value === 'cadence' ? `${option.label} · ${cadenceLabel}` : option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {state.status === 'error' && state.message && !noteError ? <p role="alert" className="text-sm text-hot">{state.message}</p> : null}
      <SaveButton />
    </form>
  );
}
