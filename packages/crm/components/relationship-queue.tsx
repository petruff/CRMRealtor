'use client';

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ContactCard } from '@/components/contact-card';
import { EmptyState, GroupedSurface } from '@/components/ui';
import {
  ContactQueryError,
  normalizeContactQuery,
  queryContacts,
} from '@/lib/application/contact-query';
import type { Contact, LeadType } from '@/lib/domain/contact';
import {
  BIRTHDAY_WINDOW_DAYS,
  HOMEAVERSARY_WINDOW_DAYS,
  type BucketId,
  type TriageBucket,
  type TriageEntry,
} from '@/lib/domain/triage';

export const RELATIONSHIP_QUEUE_BATCH_SIZE = 12;

export type QueueScope = 'now' | 'moments' | 'next-seven-days';
export type NowFilter = 'all' | 'needs-first-contact' | 'overdue' | 'due-today';
export type MomentFilter = 'all' | 'birthday' | 'homeaversary';
type LeadFilter = 'all' | LeadType;

export interface QueuePresentationState {
  scope: QueueScope;
  nowFilter: NowFilter;
  momentFilter: MomentFilter;
  leadFilter: LeadFilter;
  appliedQuery: string;
  visibleCount: number;
}

export const INITIAL_QUEUE_STATE: QueuePresentationState = {
  scope: 'now',
  nowFilter: 'all',
  momentFilter: 'all',
  leadFilter: 'all',
  appliedQuery: '',
  visibleCount: RELATIONSHIP_QUEUE_BATCH_SIZE,
};

const SCOPE_ORDER: readonly QueueScope[] = ['now', 'moments', 'next-seven-days'];
const SCOPE_BUCKETS: Record<QueueScope, readonly BucketId[]> = {
  now: ['needs-first-contact', 'overdue', 'due-today'],
  moments: ['celebrations'],
  'next-seven-days': ['coming-up'],
};
const SCOPE_LABELS: Record<QueueScope, string> = {
  now: 'Now',
  moments: 'Moments',
  'next-seven-days': 'Next 7 days',
};
const SCOPE_DESCRIPTIONS: Record<QueueScope, string> = {
  now: 'First contact, overdue, and due-today follow-ups in deterministic priority order.',
  moments: 'Birthdays and homeaversaries supported by stored relationship dates.',
  'next-seven-days': 'Stored follow-ups due within the next seven days.',
};
const NOW_FILTERS: readonly { value: NowFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-first-contact', label: 'First contact' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due-today', label: 'Due today' },
];
const MOMENT_FILTERS: readonly { value: MomentFilter; label: string }[] = [
  { value: 'all', label: 'All moments' },
  { value: 'birthday', label: 'Birthdays' },
  { value: 'homeaversary', label: 'Homeaversaries' },
];
const LEAD_FILTERS: readonly { value: LeadFilter; label: string }[] = [
  { value: 'all', label: 'All leads' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'nurture', label: 'Nurture' },
];

export function getScopeEntries(
  buckets: readonly TriageBucket[],
  scope: QueueScope,
  nowFilter: NowFilter = 'all',
  momentFilter: MomentFilter = 'all',
): TriageEntry[] {
  const entriesByBucket = new Map(buckets.map((bucket) => [bucket.id, bucket.entries]));
  const bucketIds = scope === 'now' && nowFilter !== 'all'
    ? [nowFilter]
    : SCOPE_BUCKETS[scope];
  const entries = bucketIds.flatMap((bucketId) => entriesByBucket.get(bucketId) ?? []);
  if (scope !== 'moments' || momentFilter === 'all') return entries;
  return entries.filter((entry) => isMomentEntryType(entry, momentFilter));
}

export function isMomentEntryType(entry: TriageEntry, filter: Exclude<MomentFilter, 'all'>): boolean {
  if (filter === 'birthday') {
    return Boolean(entry.contact.birthdate)
      && entry.score >= 1_000 - BIRTHDAY_WINDOW_DAYS
      && entry.score <= 1_000;
  }
  return Boolean(entry.contact.homePurchaseDate)
    && entry.score >= 500 - HOMEAVERSARY_WINDOW_DAYS
    && entry.score <= 500;
}

export function changeQueueCriteria(
  state: QueuePresentationState,
  patch: Partial<Omit<QueuePresentationState, 'visibleCount'>>,
): QueuePresentationState {
  return { ...state, ...patch, visibleCount: RELATIONSHIP_QUEUE_BATCH_SIZE };
}

export function applyQueueQuery(
  state: QueuePresentationState,
  query: string,
): { state: QueuePresentationState; error: string } {
  try {
    normalizeContactQuery(query);
    return { state: changeQueueCriteria(state, { appliedQuery: query }), error: '' };
  } catch (error) {
    return {
      state,
      error: error instanceof ContactQueryError ? error.message : 'Search could not be applied.',
    };
  }
}

export function getEligibleContactIds(
  contacts: readonly Contact[],
  query: string,
  leadFilter: LeadFilter,
): Set<string> {
  return new Set(queryContacts(contacts, {
    query,
    leadType: leadFilter === 'all' ? undefined : leadFilter,
    scope: 'all',
  }).map((contact) => contact.id));
}

export function filterQueueEntries(
  entries: readonly TriageEntry[],
  eligibleContactIds: ReadonlySet<string>,
): TriageEntry[] {
  return entries.filter((entry) => eligibleContactIds.has(entry.contact.id));
}

export function nextVisibleCount(current: number, total: number): number {
  return Math.min(current + RELATIONSHIP_QUEUE_BATCH_SIZE, total);
}

export function classifyQueueState(
  unfilteredCount: number,
  filteredCount: number,
): 'empty' | 'no-results' | 'results' {
  if (unfilteredCount === 0) return 'empty';
  if (filteredCount === 0) return 'no-results';
  return 'results';
}

function queueEntryKey(scope: QueueScope, entry: TriageEntry): string {
  return `${scope}-${entry.contact.id}-${entry.reason}`;
}

export function RelationshipQueue({
  contacts,
  buckets,
  initialState = INITIAL_QUEUE_STATE,
}: {
  contacts: readonly Contact[];
  buckets: readonly TriageBucket[];
  initialState?: QueuePresentationState;
}) {
  const [queueStateValue, setQueueStateValue] = useState<QueuePresentationState>(initialState);
  const { scope, nowFilter, momentFilter, leadFilter, appliedQuery, visibleCount } = queueStateValue;
  const [draftQuery, setDraftQuery] = useState('');
  const [queryError, setQueryError] = useState('');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const terminalStatusRef = useRef<HTMLParagraphElement | null>(null);

  const eligibleContactIds = useMemo(
    () => getEligibleContactIds(contacts, appliedQuery, leadFilter),
    [contacts, appliedQuery, leadFilter],
  );
  const scopeCounts = useMemo(() => Object.fromEntries(
    SCOPE_ORDER.map((candidate) => [
      candidate,
      filterQueueEntries(getScopeEntries(buckets, candidate), eligibleContactIds).length,
    ]),
  ) as Record<QueueScope, number>, [buckets, eligibleContactIds]);
  const unfilteredEntries = useMemo(
    () => getScopeEntries(buckets, scope, nowFilter, momentFilter),
    [buckets, momentFilter, nowFilter, scope],
  );
  const filteredEntries = useMemo(
    () => filterQueueEntries(unfilteredEntries, eligibleContactIds),
    [eligibleContactIds, unfilteredEntries],
  );
  const visibleEntries = filteredEntries.slice(0, visibleCount);
  const allShown = visibleEntries.length === filteredEntries.length;
  const remaining = Math.max(0, filteredEntries.length - visibleEntries.length);
  const loadAmount = Math.min(RELATIONSHIP_QUEUE_BATCH_SIZE, remaining);
  const queueState = classifyQueueState(unfilteredEntries.length, filteredEntries.length);

  function activateScope(nextScope: QueueScope) {
    setQueueStateValue((current) => changeQueueCriteria(current, {
      scope: nextScope,
      nowFilter: 'all',
      momentFilter: 'all',
    }));
  }

  function handleScopeKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let targetIndex: number | undefined;
    if (event.key === 'ArrowRight') targetIndex = (index + 1) % SCOPE_ORDER.length;
    if (event.key === 'ArrowLeft') targetIndex = (index - 1 + SCOPE_ORDER.length) % SCOPE_ORDER.length;
    if (event.key === 'Home') targetIndex = 0;
    if (event.key === 'End') targetIndex = SCOPE_ORDER.length - 1;
    if (targetIndex !== undefined) {
      event.preventDefault();
      tabRefs.current[targetIndex]?.focus();
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const selectedScope = SCOPE_ORDER[index];
      if (selectedScope) activateScope(selectedScope);
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = applyQueueQuery(queueStateValue, draftQuery);
    setQueueStateValue(result.state);
    setQueryError(result.error);
  }

  function clearSearch() {
    setDraftQuery('');
    setQueueStateValue((current) => changeQueueCriteria(current, { appliedQuery: '' }));
    setQueryError('');
  }

  function showNextBatch() {
    const nextCount = nextVisibleCount(visibleCount, filteredEntries.length);
    setQueueStateValue((current) => ({ ...current, visibleCount: nextCount }));
    if (nextCount === filteredEntries.length) {
      requestAnimationFrame(() => terminalStatusRef.current?.focus());
    }
  }

  const announcement = `${SCOPE_LABELS[scope]}, ${filteredEntries.length} ${filteredEntries.length === 1 ? 'result' : 'results'}, showing ${visibleEntries.length}.`;

  return (
    <section className="mt-14 min-w-0" aria-labelledby="relationship-queue-title">
      <div className="max-w-3xl">
        <p className="eyebrow">Relationship queue</p>
        <h2 id="relationship-queue-title" className="mt-1 font-display text-4xl text-ink">Who needs your attention</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Explore stored follow-ups in Now, authorized relationship moments, and the next seven days.
        </p>
        <p className="mt-3 text-sm font-medium text-ink">
          Showing {visibleEntries.length} of {filteredEntries.length} in {SCOPE_LABELS[scope]}
        </p>
      </div>

      <form className="mt-6 flex min-w-0 flex-col gap-2 sm:flex-row" role="search" onSubmit={handleSearch}>
        <div className="min-w-0 flex-1">
          <label htmlFor="relationship-queue-search" className="text-sm font-medium text-ink">Search this queue</label>
          <input
            id="relationship-queue-search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            aria-describedby={queryError ? 'relationship-queue-search-error' : 'relationship-queue-search-help'}
            aria-invalid={queryError ? true : undefined}
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-4 text-base text-ink outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="Name, phone, email, city, ZIP, or tag"
          />
          <p id="relationship-queue-search-help" className="sr-only">Search uses the shared contact query across every queue scope.</p>
          {queryError ? <p id="relationship-queue-search-error" role="alert" className="mt-2 text-sm font-medium text-hot">{queryError}</p> : null}
        </div>
        <button type="submit" className="sk-primary-button min-h-11 shrink-0 sm:self-end">Search</button>
      </form>

      <div className="mt-6 overflow-x-auto pb-1" role="tablist" aria-label="Relationship queue timeframe">
        <div className="flex min-w-max gap-2">
          {SCOPE_ORDER.map((candidate, index) => {
            const selected = scope === candidate;
            return (
              <button
                key={candidate}
                ref={(node) => { tabRefs.current[index] = node; }}
                id={`relationship-queue-tab-${candidate}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="relationship-queue-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => activateScope(candidate)}
                onKeyDown={(event) => handleScopeKeyDown(event, index)}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? 'border-line-strong bg-surface text-ink shadow-sm' : 'border-line bg-surface-2 text-muted'}`}
              >
                {SCOPE_LABELS[candidate]} · {scopeCounts[candidate]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5" role="group" aria-label="Lead type">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Lead type</p>
        <div className="flex flex-wrap gap-2">
          {LEAD_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={leadFilter === filter.value}
              onClick={() => setQueueStateValue((current) => changeQueueCriteria(current, { leadFilter: filter.value }))}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${leadFilter === filter.value ? 'border-line-strong bg-surface text-ink shadow-sm' : 'border-line bg-surface-2 text-muted'}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {scope === 'now' ? (
        <div className="mt-5" role="group" aria-label="Now status">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Now status</p>
          <div className="flex flex-wrap gap-2">
            {NOW_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={nowFilter === filter.value}
                onClick={() => setQueueStateValue((current) => changeQueueCriteria(current, { nowFilter: filter.value }))}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${nowFilter === filter.value ? 'border-line-strong bg-surface text-ink shadow-sm' : 'border-line bg-surface-2 text-muted'}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {scope === 'moments' ? (
        <div className="mt-5" role="group" aria-label="Moment type">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Moment type</p>
          <div className="flex flex-wrap gap-2">
            {MOMENT_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={momentFilter === filter.value}
                onClick={() => setQueueStateValue((current) => changeQueueCriteria(current, { momentFilter: filter.value }))}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${momentFilter === filter.value ? 'border-line-strong bg-surface text-ink shadow-sm' : 'border-line bg-surface-2 text-muted'}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        id="relationship-queue-panel"
        role="tabpanel"
        aria-labelledby={`relationship-queue-tab-${scope}`}
        className="mt-7 min-w-0"
      >
        <p className="mb-4 text-sm leading-relaxed text-muted">{SCOPE_DESCRIPTIONS[scope]}</p>
        {queueState === 'empty' ? (
          <EmptyState message={`Nothing is scheduled in ${SCOPE_LABELS[scope]} right now.`} />
        ) : queueState === 'no-results' ? (
          <EmptyState
            title={`No matches in ${SCOPE_LABELS[scope]}`}
            message={appliedQuery ? `No queue matches for “${appliedQuery}”.` : 'No contacts match the selected lead type.'}
            action={appliedQuery ? undefined : { href: '/contacts', label: 'Review contacts' }}
          />
        ) : (
          <GroupedSurface className="sk-list-grid grid min-w-0 gap-px lg:grid-cols-2">
            {visibleEntries.map((entry) => (
              <ContactCard key={queueEntryKey(scope, entry)} entry={entry} />
            ))}
          </GroupedSurface>
        )}
      </div>

      {filteredEntries.length > 0 ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!allShown ? (
            <button
              type="button"
              className="sk-secondary-button min-h-11"
              onClick={showNextBatch}
            >
              Show next {loadAmount} ({remaining} remaining)
            </button>
          ) : (
            <p ref={terminalStatusRef} tabIndex={-1} className="text-sm text-muted outline-none">All {filteredEntries.length} shown</p>
          )}
          {appliedQuery ? (
            <button type="button" className="sk-text-action min-h-11" onClick={clearSearch}>Clear search</button>
          ) : null}
        </div>
      ) : appliedQuery ? (
        <button type="button" className="sk-text-action mt-5 min-h-11" onClick={clearSearch}>Clear search</button>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </section>
  );
}
