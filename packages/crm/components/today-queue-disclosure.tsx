'use client';

import { ChevronDown, ListFilter } from 'lucide-react';
import { useId, useState } from 'react';
import { RelationshipQueue } from '@/components/relationship-queue';
import type { Contact } from '@/lib/domain/contact';
import type { TriageBucket } from '@/lib/domain/triage';

export function TodayQueueDisclosure({
  contacts,
  buckets,
}: {
  contacts: readonly Contact[];
  buckets: readonly TriageBucket[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const queueEntries = buckets.reduce((total, bucket) => total + bucket.entries.length, 0);

  return (
    <section className="today-queue-disclosure" aria-labelledby={`${panelId}-title`}>
      <button
        type="button"
        className="today-queue-disclosure-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="today-queue-disclosure-icon" aria-hidden>
          <ListFilter className="size-5" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="eyebrow">Relationship queue</span>
          <span id={`${panelId}-title`} className="mt-1 block font-display text-2xl text-ink sm:text-3xl">
            {open ? 'Close the complete work queue' : 'Explore the complete work queue'}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-muted">
            {queueEntries} {queueEntries === 1 ? 'entry' : 'entries'} across Now, relationship moments, and the next seven days
            {contacts.length ? ` · ${contacts.length} stored ${contacts.length === 1 ? 'contact' : 'contacts'}` : ''}.
          </span>
        </span>
        <span className="today-queue-disclosure-action">
          <span>{open ? 'Collapse' : 'Open queue'}</span>
          <ChevronDown className="size-5" aria-hidden />
        </span>
      </button>

      <div
        id={panelId}
        className="today-queue-disclosure-panel"
        aria-labelledby={`${panelId}-title`}
        hidden={!open}
      >
        {open ? <RelationshipQueue contacts={contacts} buckets={buckets} /> : null}
      </div>
    </section>
  );
}
