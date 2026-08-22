'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { ActionLink } from '@/components/ui';
import type { AlertCenterProps } from '@/components/alert-center';
import type { OmnixCopilotAlert, OmnixCopilotCitation } from '@/lib/domain/omnix-copilot';
import { evidenceFactSummary } from '@/lib/presentation/crm-evidence';

const FOCUS_LIMIT = 3;

const PRIORITY_LABEL = {
  urgent: 'Act now',
  high: 'High priority',
  normal: 'Planned',
  low: 'Keep in view',
} as const;

const RULE_CONTEXT: Record<OmnixCopilotAlert['rule'], string> = {
  'needs-first-contact': 'First contact is still open',
  'overdue-follow-up': 'Follow-up is overdue',
  'due-today-follow-up': 'Follow-up is due today',
  'upcoming-follow-up': 'Follow-up is approaching',
  birthday: 'Relationship moment',
  homeaversary: 'Relationship moment',
  'pipeline-missing-next-touch': 'Next step is missing',
  'mailer-missing-address': 'Mailing data needs review',
  'task-overdue': 'Task is overdue',
  'task-due-today': 'Task is due today',
};

const ACTION_LABEL = {
  'follow-up': 'Review contact',
  celebration: 'Review relationship',
  pipeline: 'Review pipeline',
  mailer: 'Review mailing data',
  task: 'Open task',
} as const;

export function boundedFocusAlerts(alerts: readonly OmnixCopilotAlert[]): readonly OmnixCopilotAlert[] {
  return alerts.slice(0, FOCUS_LIMIT);
}

function resolveCitation(
  citation: OmnixCopilotCitation,
  citations: readonly OmnixCopilotCitation[],
): OmnixCopilotCitation {
  return citations.find((candidate) => candidate.id === citation.id) ?? citation;
}

function sourceSummary(alert: OmnixCopilotAlert, citations: readonly OmnixCopilotCitation[]): string {
  const facts = alert.citations
    .map((citation) => resolveCitation(citation, citations))
    .flatMap((citation) => citation.factKeys)
    .filter((fact, index, all) => all.indexOf(fact) === index);
  return facts.length ? evidenceFactSummary(facts) : `stored ${alert.category.replace('-', ' ')} details`;
}

export function TodayFocusTimeline({
  alerts,
  citations,
  availability,
  warnings,
  dataMode,
  formattedAsOf,
  contactNames = {},
  attentionPanel,
  momentsPanel,
}: AlertCenterProps & {
  formattedAsOf: string;
  contactNames?: Readonly<Record<string, string>>;
  attentionPanel?: ReactNode;
  momentsPanel?: ReactNode;
}) {
  const priorities = useMemo(() => boundedFocusAlerts(alerts), [alerts]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = priorities[activeIndex] ?? priorities[0];

  useEffect(() => {
    if (activeIndex >= priorities.length) setActiveIndex(0);
  }, [activeIndex, priorities.length]);

  return (
    <section
      className="today-focus-shell"
      aria-labelledby="today-focus-title"
    >
      <div className="today-focus-heading">
        <div>
          <p className="eyebrow">Your next best moves</p>
          <h2 id="today-focus-title">Work the day with intention.</h2>
          <p>Three priorities at most. Choose one and it stays in place while you work.</p>
        </div>
      </div>

      {availability !== 'unavailable' && priorities.length ? <ol className="today-timeline" aria-label="Priorities for today">
        {priorities.map((alert, index) => {
          const selected = index === activeIndex;
          const contactName = contactNames[alert.recordId];
          return (
            <li key={alert.id} className="today-timeline-stop">
              <button
                type="button"
                className="today-timeline-trigger"
                aria-current={selected ? 'step' : undefined}
                aria-controls="today-focus-detail"
                onClick={() => setActiveIndex(index)}
              >
                <span className="today-timeline-index" aria-hidden>{index + 1}</span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted">{PRIORITY_LABEL[alert.priority]}</span>
                  <span className="mt-1 block text-sm font-medium text-ink">{contactName ?? RULE_CONTEXT[alert.rule]}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted">{alert.reason}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol> : <div className="today-timeline-empty-rail" aria-hidden><span /></div>}

      <div className="today-command-grid">
        {availability === 'unavailable' ? (
          <article id="today-focus-detail" className="today-focus-detail today-focus-empty" role="alert">
            <div>
              <p className="eyebrow">Priority timeline unavailable</p>
              <h3 className="mt-2 font-display text-3xl text-ink">Your stored work is still protected.</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">No priority is shown until authorized CRM facts can be read safely.</p>
              <ActionLink href="/activities" className="mt-5">Open activities</ActionLink>
            </div>
          </article>
        ) : !active ? (
          <article id="today-focus-detail" className="today-focus-detail today-focus-empty" aria-live="polite">
            <div>
              <ShieldCheck className="size-7 text-nurture" aria-hidden />
              <p className="eyebrow mt-5">Current focus</p>
              <h3 className="mt-2 font-display text-4xl text-ink">You’re clear for now.</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">No stored CRM fact matches an active alert rule as of {formattedAsOf}.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <ActionLink href="/activities">View coming activities</ActionLink>
                <ActionLink href="/contacts/new" variant="primary">Add contact</ActionLink>
              </div>
            </div>
          </article>
        ) : <article key={active.id} id="today-focus-detail" className="today-focus-detail" aria-live="polite">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">{PRIORITY_LABEL[active.priority]}</span>
            <span className="text-xs font-medium text-muted">{RULE_CONTEXT[active.rule]}</span>
          </div>
          <h3 className="today-focus-person">{contactNames[active.recordId] ?? active.reason}</h3>
          {contactNames[active.recordId] ? <p className="today-focus-reason">{active.reason}</p> : null}
          <p className="mt-4 text-xs leading-relaxed text-subtle">
            Based on {sourceSummary(active, citations)} · Updated {formattedAsOf}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ActionLink href={active.href} variant="primary">{ACTION_LABEL[active.category]} <ArrowUpRight className="size-4" aria-hidden /></ActionLink>
            <ActionLink href="/alerts">Review all {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}</ActionLink>
          </div>
        </div>
        <div className="today-focus-counter" aria-label={`Priority ${activeIndex + 1} of ${priorities.length}`}>
          <strong>{String(activeIndex + 1).padStart(2, '0')}</strong>
          <span>/ {String(priorities.length).padStart(2, '0')}</span>
        </div>
        </article>}
        {attentionPanel ? <aside className="today-command-column today-command-attention-column">{attentionPanel}</aside> : null}
        {momentsPanel ? <aside className="today-command-column today-command-moments-column">{momentsPanel}</aside> : null}
      </div>

      <footer className="today-focus-footer">
        <span>{dataMode === 'live' ? 'Live CRM' : dataMode === 'sample' ? 'Sample data' : 'Saved CRM details'}</span>
        <span>{warnings.length ? 'Some details are unavailable' : 'Based on saved records'}</span>
        <span>Updated {formattedAsOf}</span>
      </footer>
    </section>
  );
}
