'use client';

import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Gift,
  Mail,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { ActionLink } from '@/components/ui';
import type {
  OmnixCopilotAlert,
  OmnixCopilotAlertCategory,
  OmnixCopilotAlertPriority,
  OmnixCopilotCitation,
} from '@/lib/domain/omnix-copilot';
import {
  evidenceEntityLabel,
  evidenceFactSummary,
  evidenceTimestamp,
} from '@/lib/presentation/crm-evidence';
import type { AttentionItem } from '@/lib/domain/attention';
import { AttentionControls } from '@/components/attention-controls';

const BATCH_SIZE = 12;

const PRIORITY_LABEL: Record<OmnixCopilotAlertPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const CATEGORY_LABEL: Record<OmnixCopilotAlertCategory, string> = {
  'follow-up': 'Follow-up',
  celebration: 'Celebration',
  pipeline: 'Pipeline',
  mailer: 'Mailer',
  task: 'Task',
};

const ACTION_LABEL = {
  'follow-up': 'Review contact',
  celebration: 'Review contact',
  pipeline: 'Review pipeline contact',
  mailer: 'Review mailing details',
  task: 'Open task',
} as const;

const PRIORITY_TONE = {
  urgent: 'border-hot-border bg-hot-soft text-hot',
  high: 'border-warm-border bg-warm-soft text-warm',
  normal: 'border-accent/25 bg-accent-soft text-accent-strong',
  low: 'border-line bg-surface text-muted',
} as const;

const CATEGORY_ICON = {
  'follow-up': CalendarClock,
  celebration: Gift,
  pipeline: UserRoundSearch,
  mailer: Mail,
  task: CheckSquare2,
} as const;

type AlertGroupId = 'act-now' | 'coming-up' | 'relationship-moments' | 'data-readiness';

const ALERT_GROUPS: readonly {
  id: AlertGroupId;
  label: string;
  detail: string;
  tone: string;
}[] = [
  { id: 'act-now', label: 'Act now', detail: 'Urgent and high-priority work that should be reviewed first.', tone: 'border-hot-border bg-hot-soft text-hot' },
  { id: 'coming-up', label: 'Coming up', detail: 'Follow-ups and tasks that need a planned next move.', tone: 'border-warm-border bg-warm-soft text-warm' },
  { id: 'relationship-moments', label: 'Relationship moments', detail: 'Personal dates worth acknowledging with care.', tone: 'border-nurture-border bg-nurture-soft text-nurture' },
  { id: 'data-readiness', label: 'Data readiness', detail: 'Stored contact details that need attention before the next workflow.', tone: 'border-accent/25 bg-accent-soft text-accent-strong' },
];

const CATEGORIES = Object.keys(CATEGORY_LABEL) as OmnixCopilotAlertCategory[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as OmnixCopilotAlertPriority[];

function groupId(alert: OmnixCopilotAlert): AlertGroupId {
  if (alert.priority === 'urgent' || alert.priority === 'high') return 'act-now';
  if (alert.category === 'celebration') return 'relationship-moments';
  if (alert.category === 'pipeline' || alert.category === 'mailer') return 'data-readiness';
  return 'coming-up';
}

export function groupAlertsForPresentation(alerts: readonly OmnixCopilotAlert[]) {
  return ALERT_GROUPS.map((group) => ({
    ...group,
    alerts: alerts.filter((alert) => groupId(alert) === group.id),
  }));
}

function initialLimits(): Record<AlertGroupId, number> {
  return {
    'act-now': BATCH_SIZE,
    'coming-up': BATCH_SIZE,
    'relationship-moments': BATCH_SIZE,
    'data-readiness': BATCH_SIZE,
  };
}

function toggleValue<T>(values: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export interface AlertCenterProps {
  alerts: readonly OmnixCopilotAlert[];
  attentionItems?: readonly AttentionItem[];
  citations: readonly OmnixCopilotCitation[];
  warnings: readonly string[];
  asOf: string;
  availability: 'available' | 'partial' | 'unavailable';
  dataMode?: 'sample' | 'live';
  timeZone?: string;
  limit?: number;
  title?: string;
}

export function AlertCenter({
  alerts,
  attentionItems = [],
  citations,
  warnings,
  asOf,
  availability,
  dataMode,
  timeZone = 'America/New_York',
  limit,
  title = 'Alert Center',
}: AlertCenterProps) {
  const canonicalAlerts = limit === undefined ? alerts : alerts.slice(0, limit);
  const attentionByOccurrence = new Map(attentionItems.map((item) => [item.occurrenceKey, item]));
  const [query, setQuery] = useState('');
  const [groupFilters, setGroupFilters] = useState<Set<AlertGroupId>>(() => new Set());
  const [categoryFilters, setCategoryFilters] = useState<Set<OmnixCopilotAlertCategory>>(() => new Set());
  const [priorityFilters, setPriorityFilters] = useState<Set<OmnixCopilotAlertPriority>>(() => new Set());
  const [openGroups, setOpenGroups] = useState<Set<AlertGroupId>>(() => new Set(['act-now']));
  const [visibleLimits, setVisibleLimits] = useState(initialLimits);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAlerts = useMemo(() => canonicalAlerts.filter((alert) => {
    const matchesText = !normalizedQuery || [
      alert.reason,
      CATEGORY_LABEL[alert.category],
      PRIORITY_LABEL[alert.priority],
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    return matchesText
      && (groupFilters.size === 0 || groupFilters.has(groupId(alert)))
      && (categoryFilters.size === 0 || categoryFilters.has(alert.category))
      && (priorityFilters.size === 0 || priorityFilters.has(alert.priority));
  }), [canonicalAlerts, categoryFilters, groupFilters, normalizedQuery, priorityFilters]);

  const canonicalGroups = useMemo(() => groupAlertsForPresentation(canonicalAlerts), [canonicalAlerts]);
  const filteredGroups = useMemo(() => groupAlertsForPresentation(filteredAlerts), [filteredAlerts]);
  const hasCriteria = normalizedQuery.length > 0 || groupFilters.size > 0 || categoryFilters.size > 0 || priorityFilters.size > 0;
  const criteriaSummary = [
    normalizedQuery ? `search ${normalizedQuery}` : null,
    groupFilters.size ? `groups ${[...groupFilters].join(', ')}` : null,
    categoryFilters.size ? `categories ${[...categoryFilters].join(', ')}` : null,
    priorityFilters.size ? `priorities ${[...priorityFilters].join(', ')}` : null,
  ].filter(Boolean).join('; ');
  const formattedAsOf = new Date(asOf).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone,
  });
  const mountedCount = filteredGroups.reduce((total, group) => (
    total + (openGroups.has(group.id) ? Math.min(visibleLimits[group.id], group.alerts.length) : 0)
  ), 0);
  const allMatchesShown = filteredAlerts.length > 0
    && filteredGroups.every((group) => group.alerts.length === 0
      || (openGroups.has(group.id) && visibleLimits[group.id] >= group.alerts.length));
  const criteriaMessage = criteriaSummary ? ` Active criteria: ${criteriaSummary}.` : ' No filters active.';
  const liveMessage = filteredAlerts.length === 0
    ? `0 matching alerts. No alert cards shown.${criteriaMessage}`
    : allMatchesShown
      ? `All ${filteredAlerts.length} matching alerts shown.${criteriaMessage}`
      : `${filteredAlerts.length} matching alerts. ${mountedCount} shown across ${openGroups.size} open ${openGroups.size === 1 ? 'group' : 'groups'}.${criteriaMessage}`;

  const resetLimits = () => setVisibleLimits(initialLimits());
  const changeQuery = (value: string) => {
    setQuery(value);
    resetLimits();
  };
  const toggleGroupFilter = (id: AlertGroupId) => {
    setGroupFilters((current) => toggleValue(current, id));
    resetLimits();
  };
  const toggleCategoryFilter = (category: OmnixCopilotAlertCategory) => {
    setCategoryFilters((current) => toggleValue(current, category));
    resetLimits();
  };
  const togglePriorityFilter = (priority: OmnixCopilotAlertPriority) => {
    setPriorityFilters((current) => toggleValue(current, priority));
    resetLimits();
  };
  const clearCriteria = () => {
    setQuery('');
    setGroupFilters(new Set());
    setCategoryFilters(new Set());
    setPriorityFilters(new Set());
    resetLimits();
  };

  if (availability === 'unavailable') {
    return (
      <section className="sk-group bg-surface p-5 sm:p-6" aria-labelledby="alert-center-title">
        <div role="alert" className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-hot" aria-hidden />
          <div>
            <h2 id="alert-center-title" className="font-display text-2xl text-ink">Alerts could not load</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">Nothing was changed. Alert counts and record details are hidden until authorized data is available.</p>
            <ActionLink href="/activities" className="mt-5">Open activities</ActionLink>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-surface shadow-sm" aria-labelledby="alert-center-title">
      <div className="border-b border-line bg-[linear-gradient(135deg,var(--color-surface),var(--color-accent-soft))] p-5 sm:p-7">
        <p className="eyebrow flex items-center gap-2"><Sparkles className="size-4" aria-hidden /> Current priorities</p>
        <h2 id="alert-center-title" className="mt-2 font-display text-3xl leading-none text-ink sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Search and reveal stored CRM evidence without changing it. Resolving the underlying record updates this read-only view on its next authorized read.</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-muted" aria-label="Alert evidence summary">
          <span className="font-semibold text-ink">{availability === 'partial' ? `At least ${canonicalAlerts.length}` : canonicalAlerts.length} {canonicalAlerts.length === 1 ? 'alert' : 'alerts'}</span>
          <span aria-hidden>·</span><span>Updated {formattedAsOf}</span>
          {dataMode ? <><span aria-hidden>·</span><span>{dataMode === 'live' ? 'Live workspace' : 'Sample data'}</span></> : null}
          <span aria-hidden>·</span><span>{availability === 'partial' ? 'Authorized subset · incomplete evidence' : 'Authorized data available'} · Read only</span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Alert group filters">
          {canonicalGroups.map((group) => {
            const pressed = groupFilters.has(group.id);
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => toggleGroupFilter(group.id)}
                className={`min-h-11 rounded-[var(--sk-control-radius)] border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent ${group.tone} ${pressed ? 'ring-2 ring-current' : ''}`}
              >
                <span className="block text-xs font-semibold uppercase tracking-[0.1em]">{group.label}</span>
                <span className="mt-1 block text-sm font-medium text-ink">{availability === 'partial' ? `At least ${group.alerts.length}` : group.alerts.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {availability === 'partial' || warnings.length ? (
        <aside role="note" aria-label="Partial result" className="mx-5 mt-5 rounded-[var(--sk-control-radius)] border border-warm-border bg-warm-soft px-4 py-3 text-sm text-warm sm:mx-7">
          <p className="font-semibold">Partial result · counts are incomplete</p>
          <p className="mt-1">Only the authorized subset could be reviewed. Available alerts remain usable, but this is not a complete workspace count.</p>
          {warnings.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        </aside>
      ) : null}

      {canonicalAlerts.length > 0 ? (
        <div className="grid min-w-0 gap-6 p-5 sm:p-7">
          <div className="grid gap-4 rounded-[var(--sk-control-radius)] border border-line bg-surface-2 p-4">
            <label htmlFor="alert-center-search" className="text-sm font-semibold text-ink">Search alerts</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                id="alert-center-search"
                type="search"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                className="sk-input pl-10"
                placeholder="Reason, category, or priority"
              />
            </div>

            <div role="group" aria-label="Category filters">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Category</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <button key={category} type="button" aria-pressed={categoryFilters.has(category)} onClick={() => toggleCategoryFilter(category)} className={`sk-secondary-button text-xs ${categoryFilters.has(category) ? 'border-line-strong bg-surface text-ink shadow-sm' : ''}`}>
                    {CATEGORY_LABEL[category]}
                  </button>
                ))}
              </div>
            </div>

            <div role="group" aria-label="Priority filters">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Priority</p>
              <div className="flex flex-wrap gap-2">
                {PRIORITIES.map((priority) => (
                  <button key={priority} type="button" aria-pressed={priorityFilters.has(priority)} onClick={() => togglePriorityFilter(priority)} className={`sk-secondary-button text-xs ${priorityFilters.has(priority) ? 'border-line-strong bg-surface text-ink shadow-sm' : ''}`}>
                    {PRIORITY_LABEL[priority]}
                  </button>
                ))}
              </div>
            </div>

            {hasCriteria ? (
              <button type="button" onClick={clearCriteria} className="sk-text-action min-h-11 w-fit"><X className="size-4" aria-hidden /> Clear filters</button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="sk-secondary-button" onClick={() => setOpenGroups(new Set(ALERT_GROUPS.map((group) => group.id)))}>Expand all</button>
            <button type="button" className="sk-secondary-button" onClick={() => setOpenGroups(new Set())}>Collapse all</button>
          </div>

          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{liveMessage}</p>

          {filteredAlerts.length === 0 ? (
            <div className="rounded-[var(--sk-card-radius)] border border-line bg-surface-2 px-5 py-8 text-center">
              <Search className="mx-auto size-6 text-accent" aria-hidden />
              <h3 className="mt-3 font-display text-2xl text-ink">No alerts match these filters</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">The authorized alert catalog is still available; change or clear the current search and filters.</p>
              <button type="button" onClick={clearCriteria} className="sk-secondary-button mt-5">Clear filters</button>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredGroups.map((group) => {
                const isOpen = openGroups.has(group.id);
                const visibleAlerts = group.alerts.slice(0, visibleLimits[group.id]);
                const remaining = group.alerts.length - visibleAlerts.length;
                const nextAmount = Math.min(BATCH_SIZE, remaining);
                const triggerId = `alerts-${group.id}-trigger`;
                const panelId = `alerts-${group.id}-panel`;
                return (
                  <section key={group.id} className="min-w-0 rounded-[var(--sk-card-radius)] border border-line bg-surface">
                    <button
                      id={triggerId}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenGroups((current) => toggleValue(current, group.id))}
                      className="flex min-h-11 w-full items-center justify-between gap-4 rounded-[var(--sk-card-radius)] px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block font-display text-xl text-ink sm:text-2xl">{group.label}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted sm:text-sm">{group.detail}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-subtle">
                        {group.alerts.length} {group.alerts.length === 1 ? 'item' : 'items'}
                        <ChevronDown className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                      </span>
                    </button>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={triggerId}
                      aria-hidden={!isOpen}
                      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr] border-t border-line opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="px-4 py-4 sm:px-5">
                          {isOpen ? (
                            group.alerts.length > 0 ? (
                          <>
                            <ol className="grid gap-3 xl:grid-cols-2">
                              {visibleAlerts.map((alert) => {
                                const sources = alert.citations.map((citation) => citations.find((item) => item.id === citation.id) ?? citation);
                                const CategoryIcon = CATEGORY_ICON[alert.category];
                                const attentionItem = attentionByOccurrence.get(alert.occurrenceKey ?? `${alert.rule}:${alert.recordId}`);
                                return (
                                  <li key={alert.id} data-alert-id={alert.id} className={`rounded-[var(--sk-card-radius)] border p-4 ${PRIORITY_TONE[alert.priority]}`}>
                                    <article aria-labelledby={`${alert.id}-reason`}>
                                      <div className="flex items-start gap-3">
                                        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-current/15 bg-surface/80"><CategoryIcon className="size-4" aria-hidden /></span>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full bg-surface/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink">{PRIORITY_LABEL[alert.priority]}</span>
                                            <span className="text-xs font-medium text-muted">{CATEGORY_LABEL[alert.category]}</span>
                                          </div>
                                          <p id={`${alert.id}-reason`} className="mt-3 text-[15px] font-medium leading-relaxed text-ink">{alert.reason}</p>
                                        </div>
                                      </div>
                                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-current/10 pt-3">
                                        <ActionLink href={alert.href}>{ACTION_LABEL[alert.category]} <ChevronRight className="size-4" aria-hidden /></ActionLink>
                                        <details className="min-w-0">
                                          <summary className="sk-secondary-button cursor-pointer text-xs">Why this alert?</summary>
                                          <ul className="mt-2 grid gap-2 text-xs leading-relaxed text-muted">
                                            {sources.map((citation) => {
                                              const updatedAt = evidenceTimestamp(citation.sourceTimestamp, timeZone);
                                              return (
                                                <li key={citation.id} className="overflow-wrap-anywhere rounded-[var(--sk-control-radius)] bg-surface px-3 py-2">
                                                  <span className="font-medium text-ink">{evidenceEntityLabel(citation.entityType)}</span><br />
                                                  Based on {evidenceFactSummary(citation.factKeys) || 'stored CRM details'}.
                                                  {updatedAt ? ` Updated ${updatedAt}.` : ''}
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        </details>
                                      </div>
                                      {attentionItem ? <AttentionControls item={attentionItem} /> : null}
                                    </article>
                                  </li>
                                );
                              })}
                            </ol>
                            <div className="mt-4 flex min-h-11 items-center">
                              {remaining > 0 ? (
                                <button type="button" className="sk-secondary-button" onClick={() => setVisibleLimits((current) => ({ ...current, [group.id]: current[group.id] + BATCH_SIZE }))}>
                                  Show next {nextAmount} ({remaining} remaining)
                                </button>
                              ) : <p className="text-sm text-muted">All {group.alerts.length} shown</p>}
                            </div>
                          </>
                            ) : <p className="py-2 text-sm text-muted">No alerts in this group match the current criteria.</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="m-5 rounded-[var(--sk-card-radius)] bg-surface-2 px-5 py-8 text-center sm:m-7">
          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">0 matching alerts. No alert cards shown.</p>
          <ShieldCheck className="mx-auto size-6 text-nurture" aria-hidden />
          <h3 className="mt-3 font-display text-2xl text-ink">You’re clear for now</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">No authorized stored CRM record matched an existing alert rule as of {formattedAsOf}.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <ActionLink href="/activities">View coming activities</ActionLink>
            <ActionLink href="/contacts/new" variant="primary">Add contact</ActionLink>
          </div>
        </div>
      )}
    </section>
  );
}
