import Link from 'next/link';
import {
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Cable,
  CalendarClock,
  ClipboardCheck,
  MessageCircleReply,
  Route,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { TodayOperatingProjection, TodaySourceState } from '@/lib/application/today-operating-projection';

const PRIORITY_LABEL = { p0: 'Act now', p1: 'Urgent', p2: 'Important', p3: 'Planned', p4: 'Monitor' } as const;

function value(state: TodaySourceState, count: number): string | number {
  return state === 'available' ? count : '—';
}

function sourceNote(state: TodaySourceState, detail: string): string {
  return state === 'available' ? detail : 'Could not verify this area right now';
}

export function TodayOperatingBriefing({ projection }: { projection: TodayOperatingProjection }) {
  const streams = [
    {
      label: 'Approvals', value: value(projection.approvals.state, projection.approvals.count),
      detail: sourceNote(projection.approvals.state, projection.approvals.topLabel ?? 'No proposal is waiting'),
      href: '/approvals', icon: ClipboardCheck, tone: 'accent',
    },
    {
      label: 'Replies', value: value(projection.replies.state, projection.replies.count),
      detail: sourceNote(projection.replies.state, projection.replies.topLabel ? `Oldest: ${projection.replies.topLabel}` : 'No reply is waiting'),
      href: '/approvals', icon: MessageCircleReply, tone: 'nurture',
    },
    {
      label: 'Deadlines', value: value(projection.deadlines.state, projection.deadlines.count),
      detail: sourceNote(projection.deadlines.state, projection.deadlines.overdue
        ? `${projection.deadlines.overdue} overdue · ${projection.deadlines.topLabel ?? 'review required'}`
        : projection.deadlines.topLabel ?? 'No open deadline'),
      href: '/transactions', icon: CalendarClock, tone: projection.deadlines.overdue ? 'hot' : 'warm',
    },
    {
      label: 'Nurture', value: value(projection.growth.state, projection.growth.activeNurtures),
      detail: sourceNote(projection.growth.state, projection.growth.dueNurtures
        ? `${projection.growth.dueNurtures} ready for the next governed step` : 'No nurture step is due'),
      href: '/nurture', icon: Route, tone: 'nurture',
    },
    {
      label: 'Transactions', value: value(projection.business.state, projection.business.activeTransactions),
      detail: sourceNote(projection.business.state, `${projection.business.underContract} under contract`),
      href: '/transactions', icon: BriefcaseBusiness, tone: 'warm',
    },
    {
      label: 'Connections', value: value(projection.connections.state, projection.connections.needsAttention),
      detail: sourceNote(projection.connections.state, projection.connections.needsAttention
        ? `${projection.connections.labels.join(', ')} ${projection.connections.needsAttention === 1 ? 'needs' : 'need'} attention`
        : `${projection.connections.connected} verified active`),
      href: '/connections', icon: Cable, tone: projection.connections.needsAttention ? 'hot' : 'accent',
    },
  ] as const;

  return (
    <section className="today-operating-briefing" aria-labelledby="today-operating-title">
      <div className="today-operating-heading">
        <div>
          <p className="eyebrow">Omnix operating brief</p>
          <h2 id="today-operating-title">One view of what can move the business today.</h2>
          <p>Every count resolves to saved CRM records. Unavailable reads remain unknown instead of becoming a false zero.</p>
        </div>
        <span className={`today-operating-trust ${projection.sourceState === 'available' ? 'is-complete' : 'needs-review'}`}>
          {projection.sourceState === 'available' ? <BadgeCheck className="size-4" aria-hidden /> : <ShieldAlert className="size-4" aria-hidden />}
          {projection.sourceState === 'available' ? 'All sources checked' : 'Some sources unavailable'}
        </span>
      </div>

      <div className="today-operating-layout">
        <article className="today-priority-ledger" aria-labelledby="today-priority-title">
          <div className="today-priority-ledger-heading">
            <span className="today-visual-card-icon"><Sparkles className="size-[18px]" aria-hidden /></span>
            <div>
              <p>Canonical attention queue</p>
              <h3 id="today-priority-title">Top priorities, already in order</h3>
            </div>
          </div>
          {projection.priorityContributors.length ? (
            <ol className="today-priority-list">
              {projection.priorityContributors.map((item, index) => (
                <li key={item.id}>
                  <Link href={item.href}>
                    <span className={`today-priority-index is-${item.priority}`}>{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="today-priority-meta">{PRIORITY_LABEL[item.priority]} · {item.category}</span>
                      <strong>{item.reason}</strong>
                      <small>{item.evidenceCount} {item.evidenceCount === 1 ? 'verified contributor' : 'verified contributors'}</small>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0" aria-hidden />
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <div className="today-priority-empty">
              <BadgeCheck className="size-5 text-nurture" aria-hidden />
              <strong>No active priority is waiting.</strong>
              <p>Omnix will place durable attention items here when a verified rule is triggered.</p>
            </div>
          )}
          <Link href="/alerts" className="today-operating-footer-link">Open full priority queue <ArrowUpRight className="size-4" aria-hidden /></Link>
        </article>

        <div className="today-workstream-grid" aria-label="Operational workstreams">
          {streams.map(({ label, value: streamValue, detail, href, icon: Icon, tone }) => (
            <Link href={href} key={label} className={`today-workstream-card is-${tone}`}>
              <span className="today-workstream-icon"><Icon className="size-[18px]" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span>{label}</span>
                <small>{detail}</small>
              </span>
              <strong>{streamValue}</strong>
            </Link>
          ))}
        </div>
      </div>

      {projection.unknowns.count > 0 && (
        <details className="today-unknowns">
          <summary><ShieldAlert className="size-4" aria-hidden /> {projection.unknowns.count} {projection.unknowns.count === 1 ? 'area needs' : 'areas need'} confirmation</summary>
          <ul>{projection.unknowns.labels.map((label) => <li key={label}>{label}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
