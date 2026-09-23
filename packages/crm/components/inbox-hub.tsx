import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, ClipboardCheck, ListChecks, MessageCircleReply, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import type { InboxItem, InboxKind, InboxProjection } from '@/lib/application/inbox-projection';
import { formatDueLabel, formatSince } from '@/lib/presentation/us-dates';

const KIND_ICON: Record<InboxKind, LucideIcon> = {
  reply: MessageCircleReply,
  approval: ClipboardCheck,
  task: ListChecks,
  alert: AlertTriangle,
};

function itemMeta(item: InboxItem, now: Date, timeZone: string): string | undefined {
  if (!item.at) return undefined;
  if (item.kind === 'task') return formatDueLabel(item.at, now);
  if (item.kind === 'reply') return formatSince(item.at, now, timeZone);
  return undefined;
}

function summaryLine(projection: InboxProjection): string {
  if (projection.total === 0) return 'Nothing is waiting on you right now.';
  const things = `${projection.total} ${projection.total === 1 ? 'thing is' : 'things are'} waiting on you`;
  return projection.urgent ? `${things} · ${projection.urgent} urgent` : things;
}

export function InboxHub({ projection, asOf, timeZone }: { projection: InboxProjection; asOf: string; timeZone: string }) {
  const now = new Date(asOf);
  return (
    <div className="ox-stack">
      <PageHeader
        eyebrow="Inbox"
        title="Waiting on you"
        titleId="inbox-title"
        description={summaryLine(projection)}
        actions={<Link href="/omnix" className="sk-secondary-button"><Sparkles className="size-4" aria-hidden /> Ask Omnix</Link>}
      />

      {projection.total === 0 && projection.sections.every((section) => section.available) ? (
        <section className="ox-empty-hero" aria-labelledby="inbox-zero-title">
          <span className="ox-empty-hero-icon"><CheckCircle2 className="size-7" aria-hidden /></span>
          <h2 id="inbox-zero-title">You&apos;re all caught up.</h2>
          <p>No replies, approvals, tasks or deal alerts need a decision. Today has the people worth reaching next.</p>
          <Link href="/" className="sk-primary-button">Go to Today</Link>
        </section>
      ) : (
        <div className="ox-inbox-grid">
          {projection.sections.map((section) => {
            const Icon = KIND_ICON[section.kind];
            return (
              <section key={section.kind} className="ox-card" aria-labelledby={`inbox-${section.kind}`}>
                <header className="ox-card-header">
                  <span className={`ox-icon-chip ox-tone-${section.kind}`}><Icon className="size-4" aria-hidden /></span>
                  <h2 id={`inbox-${section.kind}`} className="ox-card-title">{section.label}</h2>
                  {section.available ? <span className="ox-count" aria-label={`${section.total} items`}>{section.total}</span> : null}
                </header>
                {!section.available ? (
                  <p className="ox-card-empty" role="status">This list could not be loaded right now. Nothing was changed.</p>
                ) : section.items.length === 0 ? (
                  <p className="ox-card-empty"><CheckCircle2 className="size-4 text-nurture" aria-hidden /> {section.emptyLabel}</p>
                ) : (
                  <ul className="ox-list">
                    {section.items.map((item) => {
                      const meta = itemMeta(item, now, timeZone);
                      return (
                        <li key={item.id}>
                          <Link href={item.href} className="ox-list-row">
                            {item.urgent ? <span className="ox-urgent-dot" aria-label="Urgent" /> : <span className="ox-urgent-dot is-quiet" aria-hidden />}
                            <span className="min-w-0 flex-1">
                              <span className="ox-row-title">{item.title}</span>
                              {item.detail ? <span className="ox-row-detail">{item.detail}</span> : null}
                            </span>
                            {meta ? <span className={`ox-row-meta ${item.urgent ? 'text-hot' : ''}`}>{meta}</span> : null}
                            <ChevronRight className="ox-row-chevron" aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {section.available && section.total > section.items.length ? (
                  <Link href={section.href} className="ox-card-footer-link">View all {section.total} <ChevronRight className="size-4" aria-hidden /></Link>
                ) : section.available && section.total > 0 ? (
                  <Link href={section.href} className="ox-card-footer-link">Open {section.label.toLowerCase()} <ChevronRight className="size-4" aria-hidden /></Link>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
