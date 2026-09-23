'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Search,
  UsersRound,
  X,
} from 'lucide-react';

type DisplayStatus = 'available' | 'possibly-truncated' | 'insufficient-evidence';
type EntityFilter = 'all' | 'contact' | 'task';
type ContributorSort = 'metric-order' | 'name-ascending' | 'name-descending';

export interface InsightsContributorView {
  entityType: 'contact' | 'task';
  recordId: string;
  label: string;
  href?: string;
  detail?: string;
}

export interface InsightsDrilldownView {
  id: string;
  label: string;
  status: DisplayStatus;
  scope: 'snapshot' | 'current-period';
  contributors: readonly InsightsContributorView[];
}

interface InsightsContributorExplorerProps {
  readonly periodDays: 30 | 90 | 365;
  readonly currentFrom: string;
  readonly currentTo: string;
  readonly drilldowns: readonly InsightsDrilldownView[];
  readonly selectedDrilldownId: string;
}

const PAGE_SIZE = 12;

function contributorInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'CR';
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words.at(-1)?.[0] ?? '' : ''}`.toUpperCase();
}

function scopeLabel(
  scope: InsightsDrilldownView['scope'],
  periodDays: number,
  currentFrom: string,
  currentTo: string,
): string {
  return scope === 'snapshot'
    ? `Current snapshot · ${currentTo.slice(0, 10)}`
    : `${periodDays}-day cohort · ${currentFrom.slice(0, 10)} to ${currentTo.slice(0, 10)}`;
}

function statusLabel(status: DisplayStatus): string {
  if (status === 'available') return 'Verified exact set';
  if (status === 'possibly-truncated') return 'Incomplete evidence set';
  return 'Evidence unavailable';
}

export function InsightsContributorExplorer({
  periodDays,
  currentFrom,
  currentTo,
  drilldowns,
  selectedDrilldownId,
}: InsightsContributorExplorerProps) {
  const fallbackId = drilldowns[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState(selectedDrilldownId || fallbackId);
  const [query, setQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [sort, setSort] = useState<ContributorSort>('metric-order');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setSelectedId(selectedDrilldownId || fallbackId);
    setQuery('');
    setEntityFilter('all');
    setSort('metric-order');
    setPage(1);
  }, [fallbackId, selectedDrilldownId]);

  const selected = drilldowns.find((item) => item.id === selectedId) ?? drilldowns[0];
  const normalizedQuery = query.trim().toLocaleLowerCase('en-US');
  const filteredContributors = useMemo(() => {
    if (!selected) return [];
    const filtered = selected.contributors.filter((contributor) => {
      const matchesType = entityFilter === 'all' || contributor.entityType === entityFilter;
      const searchable = `${contributor.label} ${contributor.detail ?? ''}`.toLocaleLowerCase('en-US');
      return matchesType && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
    if (sort === 'metric-order') return filtered;
    return [...filtered].sort((left, right) => {
      const comparison = left.label.localeCompare(right.label, 'en-US', { sensitivity: 'base' });
      return sort === 'name-ascending' ? comparison : -comparison;
    });
  }, [entityFilter, normalizedQuery, selected, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredContributors.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visibleContributors = filteredContributors.slice(pageStart, pageStart + PAGE_SIZE);
  const contactCount = selected?.contributors.filter((item) => item.entityType === 'contact').length ?? 0;
  const taskCount = (selected?.contributors.length ?? 0) - contactCount;

  function resetResultControls() {
    setQuery('');
    setEntityFilter('all');
    setSort('metric-order');
    setPage(1);
  }

  function changeMetric(nextId: string) {
    setSelectedId(nextId);
    resetResultControls();
    const url = new URL(window.location.href);
    url.searchParams.set('period', String(periodDays));
    url.searchParams.set('detail', nextId);
    url.hash = 'contributor-details';
    window.history.replaceState(window.history.state, '', url);
  }

  if (!selected) {
    return <p className="insights-contributor-empty">No metric contributor contract is available.</p>;
  }

  const showingFrom = filteredContributors.length ? pageStart + 1 : 0;
  const showingTo = Math.min(pageStart + PAGE_SIZE, filteredContributors.length);
  const hasFilters = Boolean(query) || entityFilter !== 'all' || sort !== 'metric-order';

  return (
    <div className="insights-contributor-explorer">
      <div className="insights-contributor-hero">
        <div>
          <p className="eyebrow">Selected metric</p>
          <h3>{selected.label}</h3>
          <p>{scopeLabel(selected.scope, periodDays, currentFrom, currentTo)}</p>
        </div>
        <span className={`insights-contributor-status is-${selected.status}`}>{statusLabel(selected.status)}</span>
      </div>

      <div className="insights-contributor-summary" aria-label="Contributor summary">
        <article><span>Exact set</span><strong>{selected.contributors.length}</strong><small>records behind this metric</small></article>
        <article><span>Contacts</span><strong>{contactCount}</strong><small>relationship records</small></article>
        <article><span>Tasks</span><strong>{taskCount}</strong><small>work records</small></article>
      </div>

      <div className="insights-contributor-controls">
        <label className="insights-contributor-metric">
          <span>Metric detail</span>
          <select id="insights-metric-detail" name="insightsMetricDetail" value={selected.id} className="sk-input" onChange={(event) => changeMetric(event.target.value)}>
            {drilldowns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="insights-contributor-search">
          <span>Find a contributor</span>
          <span><Search className="size-4" aria-hidden /><input id="insights-contributor-search" name="insightsContributorSearch" autoComplete="off" value={query} maxLength={120} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search name or context" /></span>
        </label>
        <label>
          <span>Record type</span>
          <select id="insights-record-type" name="insightsRecordType" value={entityFilter} className="sk-input" onChange={(event) => { setEntityFilter(event.target.value as EntityFilter); setPage(1); }}>
            <option value="all">All records</option>
            <option value="contact">Contacts</option>
            <option value="task">Tasks</option>
          </select>
        </label>
        <label>
          <span>Order</span>
          <select id="insights-contributor-order" name="insightsContributorOrder" value={sort} className="sk-input" onChange={(event) => { setSort(event.target.value as ContributorSort); setPage(1); }}>
            <option value="metric-order">Metric order</option>
            <option value="name-ascending">Name A–Z</option>
            <option value="name-descending">Name Z–A</option>
          </select>
        </label>
      </div>

      {selected.status === 'insufficient-evidence' ? (
        <div className="insights-contributor-empty is-unavailable" role="status">
          <ListFilter className="size-6" aria-hidden />
          <div><strong>Contributor evidence is unavailable</strong><p>The metric remains withheld because its source records were not loaded safely.</p></div>
        </div>
      ) : selected.contributors.length === 0 ? (
        <div className="insights-contributor-empty" role="status">
          <UsersRound className="size-6" aria-hidden />
          <div><strong>No contributors in this scope</strong><p>This is a verified empty set, not a failed read.</p></div>
        </div>
      ) : filteredContributors.length === 0 ? (
        <div className="insights-contributor-empty" role="status">
          <Search className="size-6" aria-hidden />
          <div><strong>No matching contributors</strong><p>Try a different name or clear the active filters.</p></div>
          <button type="button" className="sk-button-secondary" onClick={resetResultControls}><X className="size-4" aria-hidden /> Clear filters</button>
        </div>
      ) : (
        <>
          <div className="insights-contributor-results-heading">
            <p aria-live="polite">Showing <strong>{showingFrom}–{showingTo}</strong> of <strong>{filteredContributors.length}</strong>{hasFilters ? ` matching ${selected.contributors.length} exact records` : ' exact records'}</p>
            {hasFilters ? <button type="button" onClick={resetResultControls}><X className="size-4" aria-hidden /> Reset view</button> : null}
          </div>
          <ul className="insights-contributor-list">
            {visibleContributors.map((contributor) => (
              <li key={`${contributor.entityType}:${contributor.recordId}`}>
                <span className="insights-contributor-avatar" aria-hidden>{contributorInitials(contributor.label)}</span>
                <div>
                  <span className="insights-contributor-type">{contributor.entityType === 'contact' ? 'Contact' : 'Task'}</span>
                  <strong>{contributor.label}</strong>
                  <small>{contributor.detail ?? (contributor.entityType === 'contact' ? 'Stored relationship record' : 'Stored work record')}</small>
                </div>
                {contributor.href ? <Link href={contributor.href} aria-label={`Open ${contributor.label}`}><span>Open record</span><ArrowUpRight className="size-4" aria-hidden /></Link> : <span className="insights-contributor-no-action">Record preserved</span>}
              </li>
            ))}
          </ul>
          <nav className="insights-contributor-pagination" aria-label="Contributor pages">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage === 1}><ChevronLeft className="size-4" aria-hidden /> Previous</button>
            <span>Page <strong>{safePage}</strong> of <strong>{pageCount}</strong></span>
            <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={safePage === pageCount}>Next <ChevronRight className="size-4" aria-hidden /></button>
          </nav>
        </>
      )}
    </div>
  );
}
