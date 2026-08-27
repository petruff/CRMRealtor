import Link from 'next/link';
import { Activity, ChevronRight, Layers3 } from 'lucide-react';
import type { ActivityEvent } from '@/lib/domain/activity';
import type { Contact } from '@/lib/domain/contact';
import { groupRecentActivity } from '@/lib/presentation/activity-feed';

export function RecentActivityFeed({ events, contacts, timeZone }: {
  readonly events: readonly ActivityEvent[];
  readonly contacts: readonly Contact[];
  readonly timeZone: string;
}) {
  const groups = groupRecentActivity(events, contacts);
  if (!groups.length) return null;
  return (
    <section className="mt-10 overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-surface shadow-sm">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-[linear-gradient(135deg,var(--color-surface),var(--color-accent-soft))] p-5 sm:p-7">
        <div>
          <p className="eyebrow">Relationship history</p>
          <h2 className="mt-2 font-display text-3xl text-ink">Recent activity</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">A concise timeline of what changed, grouped so repeated import and cleanup work does not overwhelm your day.</p>
        </div>
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted">{events.length} events · {groups.length} moments</span>
      </header>
      <ol className="divide-y divide-line">
        {groups.map((group) => (
          <li key={group.id} className="grid gap-3 p-5 transition-colors hover:bg-surface-2/70 sm:grid-cols-[2.75rem_1fr_auto] sm:items-start sm:px-7">
            <span className="grid size-11 place-items-center rounded-full border border-accent/20 bg-accent-soft text-accent-strong">
              {group.count > 1 ? <Layers3 className="size-4" aria-hidden /> : <Activity className="size-4" aria-hidden />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-semibold text-ink">{group.label}</h3>
                {group.count > 1 ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{group.count} updates</span> : null}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{group.detail}</p>
              {group.contacts.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {group.contacts.slice(0, 4).map((contact) => (
                    <Link key={contact.id} href={`/contacts/${encodeURIComponent(contact.id)}`} className="sk-text-action text-xs">
                      {contact.name}<ChevronRight className="size-3" aria-hidden />
                    </Link>
                  ))}
                  {group.contacts.length > 4 ? <span className="text-xs text-subtle">+{group.contacts.length - 4} more</span> : null}
                </div>
              ) : null}
            </div>
            <time className="text-xs font-medium text-subtle sm:pt-1" dateTime={group.occurredAt}>
              {new Intl.DateTimeFormat('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone,
              }).format(new Date(group.occurredAt))}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
