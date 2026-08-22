import Link from 'next/link';
import { CalendarCheck2 } from 'lucide-react';
import { recordContactTouchAction } from '@/app/contact-actions';
import { RecordTouchForm } from '@/components/contact-mutations';
import { ensureNextTouch } from '@/lib/domain/cadence';
import { displayName, type Contact } from '@/lib/domain/contact';
import { buildTriage } from '@/lib/domain/triage';

export function CadenceFollowUpQueue({
  contacts: storedContacts,
  historicalImportContactIds,
  renderedAt,
}: {
  contacts: readonly Contact[];
  historicalImportContactIds: ReadonlySet<string>;
  renderedAt: string;
}) {
  const now = new Date(renderedAt);
  const contacts = storedContacts.map((contact) => ensureNextTouch(contact, now));
  const buckets = buildTriage(contacts, now, { historicalImportContactIds });
  const due = buckets
    .filter((bucket) => ['needs-first-contact', 'overdue', 'due-today'].includes(bucket.id))
    .flatMap((bucket) => bucket.entries.map((entry) => ({ bucket: bucket.title, entry })));

  return (
    <section className="mb-8" aria-labelledby="cadence-follow-ups-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Relationship follow-ups</p>
          <h2 id="cadence-follow-ups-title" className="mt-1 font-display text-2xl text-ink">
            {due.length ? `${due.length} due now` : 'You are caught up'}
          </h2>
          <p className="mt-1 text-sm text-muted">
            This is the same Hot, Warm and Nurture schedule used by Today and Alerts.
          </p>
        </div>
        <Link href="/" className="sk-text-action">Open Today</Link>
      </div>
      {due.length ? (
        <ol className="sk-group grid gap-px lg:grid-cols-2">
          {due.map(({ bucket, entry }) => (
            <li key={`${bucket}:${entry.contact.id}`} className="bg-surface p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{bucket}</p>
                  <Link href={`/contacts/${encodeURIComponent(entry.contact.id)}`} className="mt-1 block truncate font-medium text-ink hover:text-accent">
                    {displayName(entry.contact)}
                  </Link>
                  <p className="mt-1 text-sm text-muted">{entry.reason} · {entry.contact.leadType}</p>
                </div>
                <CalendarCheck2 className="size-5 shrink-0 text-accent" aria-hidden />
              </div>
              <RecordTouchForm action={recordContactTouchAction.bind(null, entry.contact.id)} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-[var(--sk-card-radius)] border border-nurture-border bg-nurture-soft p-5 text-sm text-nurture">
          No relationship follow-up is overdue or due today. Upcoming contacts remain visible on Today.
        </div>
      )}
    </section>
  );
}
