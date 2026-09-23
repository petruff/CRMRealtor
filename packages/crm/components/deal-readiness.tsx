import { randomUUID } from 'node:crypto';
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, ShieldCheck } from 'lucide-react';
import { recordReadinessAction } from '@/app/transactions/actions';
import { READINESS_BOUNDARY, type ReadinessCheck } from '@/lib/domain/florida-readiness';

const ICON = { ok: CheckCircle2, attention: CircleDashed, urgent: AlertTriangle } as const;

/**
 * Florida readiness strip on a deal card: what must be on file, whether it is,
 * and a one-step way to record it with its source.
 */
export function DealReadiness({ checks, today }: { checks: readonly ReadinessCheck[]; today: string }) {
  if (!checks.length) return null;
  const open = checks.filter((check) => check.tone !== 'ok').length;
  const urgent = checks.some((check) => check.tone === 'urgent');
  return (
    <section className="ox-readiness" aria-label="Florida readiness">
      <header className="ox-readiness-header">
        <ShieldCheck className="size-4" aria-hidden />
        <span>Florida readiness</span>
        <span className={`ox-readiness-count ${urgent ? 'is-urgent' : open ? 'is-open' : 'is-clear'}`}>{open ? `${open} to do` : 'All on file'}</span>
      </header>
      <ul className="ox-readiness-list">
        {checks.map((check) => {
          const Icon = ICON[check.tone];
          return (
            <li key={check.key} className={`ox-readiness-item is-${check.tone}`}>
              <Icon className="ox-readiness-icon" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="ox-readiness-title">{check.title}</p>
                <p className="ox-readiness-detail">{check.detail}{check.evidence ? <span> · {check.evidence}</span> : null}</p>
                {check.tone !== 'ok' ? (
                  <details className="ox-readiness-record">
                    <summary>Record it</summary>
                    <form action={recordReadinessAction} className="ox-readiness-form">
                      <input type="hidden" name="transactionId" value={check.transactionId} />
                      <input type="hidden" name="key" value={check.key} />
                      <input type="hidden" name="requestId" value={randomUUID()} />
                      <fieldset className="ox-chips" aria-label="What happened">
                        <label className="ox-chip"><input type="radio" name="outcome" value="on-file" defaultChecked /><span>{check.key === 'flood-disclosure' ? 'Delivered' : 'Signed'}</span></label>
                        <label className="ox-chip"><input type="radio" name="outcome" value="not-applicable" /><span>Doesn’t apply</span></label>
                      </fieldset>
                      <label className="sk-field"><span className="sk-label">Where it lives or why it doesn’t apply</span>
                        <input className="sk-input" name="reference" required minLength={2} maxLength={240} placeholder={check.key === 'flood-disclosure' ? 'e.g. Flood disclosure in Dotloop, signed by buyer' : 'e.g. Exclusive buyer agreement in Dotloop'} />
                      </label>
                      <label className="sk-field max-w-[12rem]"><span className="sk-label">Document date</span>
                        <input className="sk-input" type="date" name="sourceDate" defaultValue={today} max={today} required />
                      </label>
                      <button type="submit" className="sk-primary-button">Save to deal</button>
                    </form>
                  </details>
                ) : null}
              </div>
              <a className="ox-readiness-source" href={check.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Source for ${check.title}`}>
                Source <ExternalLink className="size-3" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="ox-readiness-boundary">{READINESS_BOUNDARY}</p>
    </section>
  );
}
