'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CalendarRange, CheckCircle2 } from 'lucide-react';
import type { TimelineState } from '@/app/transactions/timeline-actions';
import { TIMELINE_DEFAULTS, parseTimelineInput, proposeTimeline, type ProposedDeadline } from '@/lib/domain/florida-contract-timeline';

type Action = (state: TimelineState, formData: FormData) => Promise<TimelineState>;

const format = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" className={`sk-primary-button${pending ? ' ox-busy' : ''}`} disabled={pending}>{pending ? 'Saving…' : 'Add these dates to the deal'}</button>;
}

/**
 * Florida "AS IS" contract timeline: enter the Effective Date and closing
 * date, confirm the periods, and every deadline is created with reminders.
 */
export function ContractTimelineBuilder({ action, defaultClosingDate, today }: { action: Action; defaultClosingDate?: string; today: string }) {
  const [state, formAction] = useActionState(action, { status: 'idle' } as TimelineState);
  const [values, setValues] = useState<Record<string, string>>({
    effectiveDate: today, closingDate: defaultClosingDate ?? '', financing: 'financed',
    depositDays: String(TIMELINE_DEFAULTS.depositDays), inspectionDays: String(TIMELINE_DEFAULTS.inspectionDays),
    loanApplicationDays: String(TIMELINE_DEFAULTS.loanApplicationDays), loanApprovalDays: String(TIMELINE_DEFAULTS.loanApprovalDays),
    additionalDepositDays: '',
  });
  const preview = useMemo((): ProposedDeadline[] => {
    try {
      const data = new FormData();
      for (const [key, value] of Object.entries(values)) data.set(key, value);
      return proposeTimeline(parseTimelineInput(data));
    } catch { return []; }
  }, [values]);
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const error = (key: string) => state.fieldErrors?.[key] ? <span className="sk-error">{state.fieldErrors[key]}</span> : null;
  const financed = values.financing !== 'cash';

  if (state.status === 'saved') {
    return <p className="ox-timeline-saved" role="status"><CheckCircle2 className="size-5" aria-hidden /> {state.message}</p>;
  }

  return (
    <form action={formAction} className="ox-timeline-form">
      <div className="ox-timeline-grid">
        <label className="sk-field"><span className="sk-label">Effective Date</span><input className="sk-input" type="date" name="effectiveDate" value={values.effectiveDate} onChange={set('effectiveDate')} required />{error('effectiveDate')}</label>
        <label className="sk-field"><span className="sk-label">Closing date</span><input className="sk-input" type="date" name="closingDate" value={values.closingDate} onChange={set('closingDate')} required />{error('closingDate')}</label>
      </div>
      <fieldset className="ox-chips" aria-label="Financing">
        <label className="ox-chip"><input type="radio" name="financing" value="financed" checked={financed} onChange={set('financing')} /><span>Financed</span></label>
        <label className="ox-chip"><input type="radio" name="financing" value="cash" checked={!financed} onChange={set('financing')} /><span>Cash</span></label>
      </fieldset>
      <div className="ox-timeline-grid is-periods">
        <label className="sk-field"><span className="sk-label">Initial deposit (days)</span><input className="sk-input" type="number" min={1} max={30} name="depositDays" value={values.depositDays} onChange={set('depositDays')} />{error('depositDays')}</label>
        <label className="sk-field"><span className="sk-label">Inspection period (days)</span><input className="sk-input" type="number" min={1} max={60} name="inspectionDays" value={values.inspectionDays} onChange={set('inspectionDays')} />{error('inspectionDays')}</label>
        {financed ? <>
          <label className="sk-field"><span className="sk-label">Loan application (days)</span><input className="sk-input" type="number" min={1} max={30} name="loanApplicationDays" value={values.loanApplicationDays} onChange={set('loanApplicationDays')} />{error('loanApplicationDays')}</label>
          <label className="sk-field"><span className="sk-label">Loan approval period (days)</span><input className="sk-input" type="number" min={1} max={90} name="loanApprovalDays" value={values.loanApprovalDays} onChange={set('loanApprovalDays')} />{error('loanApprovalDays')}</label>
        </> : null}
        <label className="sk-field"><span className="sk-label">Additional deposit (days) <span className="font-normal text-subtle">(optional)</span></span><input className="sk-input" type="number" min={1} max={90} name="additionalDepositDays" value={values.additionalDepositDays} onChange={set('additionalDepositDays')} />{error('additionalDepositDays')}</label>
      </div>
      {preview.length ? (
        <ol className="ox-timeline-preview" aria-label="Dates to be added">
          {preview.map((item) => (
            <li key={item.key}>
              <CalendarRange className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{item.label}</span>
              <strong>{format(item.date)}</strong>
              {item.rolled ? <small>moved past a weekend or holiday</small> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <label className="ox-toggle-row">
        <input type="checkbox" name="confirmed" />
        <span><strong>These periods match the signed contract</strong><small>Blank periods on the FR/BAR “AS IS” form default to 3/5/15/30 days. Days are calendar days from the Effective Date; a period ending on a weekend or national legal holiday moves to the next business day. Not legal advice — confirm with your broker.</small></span>
      </label>
      {state.status === 'error' && state.message ? <p role="alert" className="text-sm text-hot">{state.message}</p> : null}
      <div><Save /></div>
    </form>
  );
}
