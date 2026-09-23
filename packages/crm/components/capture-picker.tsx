'use client';

import Link from 'next/link';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { ChevronRight, Search, UserRoundPlus } from 'lucide-react';
import { Avatar, LeadBadge } from '@/components/ui';
import { filterCaptureCandidates, type CaptureCandidate } from '@/lib/application/capture-candidates';

const VISIBLE_LIMIT = 40;

export function CapturePicker({ candidates }: { candidates: readonly CaptureCandidate[] }) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const searchId = useId();
  const matches = useMemo(() => filterCaptureCandidates(candidates, deferred), [candidates, deferred]);
  const visible = matches.slice(0, VISIBLE_LIMIT);
  const suggested = !deferred.trim();

  return (
    <div className="ox-card ox-picker">
      <div className="ox-search-field">
        <Search className="size-5 text-muted" aria-hidden />
        <label htmlFor={searchId} className="sr-only">Find the person you talked to</label>
        <input
          id={searchId}
          type="search"
          autoFocus
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, phone or city"
          className="ox-search-input"
        />
      </div>
      <p className="ox-picker-caption" aria-live="polite">
        {suggested ? 'Suggested — people on your list today first' : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}
      </p>
      {visible.length ? (
        <ul className="ox-list">
          {visible.map((candidate) => (
            <li key={candidate.id}>
              <Link href={`/contacts/${encodeURIComponent(candidate.id)}/outcome`} className="ox-list-row is-person">
                <Avatar initials={candidate.initials} leadType={candidate.leadType} relationship={candidate.relationship} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="ox-row-title">{candidate.name}</span>
                    <LeadBadge leadType={candidate.leadType} relationship={candidate.relationship} />
                  </span>
                  <span className="ox-row-detail">{candidate.reason ?? ([candidate.phone, candidate.city].filter(Boolean).join(' · ') || 'No phone on file')}</span>
                </span>
                <ChevronRight className="ox-row-chevron" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ox-card-empty is-stacked">
          <p>No one matches “{deferred.trim()}”.</p>
          <Link href="/contacts/new" className="sk-secondary-button"><UserRoundPlus className="size-4" aria-hidden /> Add a new contact</Link>
        </div>
      )}
      {matches.length > VISIBLE_LIMIT ? <p className="ox-picker-caption">Keep typing to narrow {matches.length - VISIBLE_LIMIT} more.</p> : null}
    </div>
  );
}
