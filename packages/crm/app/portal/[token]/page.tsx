import type { Metadata } from 'next';
import { CalendarClock, CheckCircle2, Circle, Home, KeyRound, LockKeyhole, MinusCircle } from 'lucide-react';
import { openClientPortal } from '@/lib/data';
import { isPortalToken, portalView, type PortalStep } from '@/lib/domain/client-portal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your home, step by step',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

function stepDate(step: PortalStep): string | undefined {
  if (!step.date) return undefined;
  const timeZone = step.timezone && step.timezone !== 'UTC' ? step.timezone : 'UTC';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(new Date(step.date));
}

const STEP_ICON = { done: CheckCircle2, current: CalendarClock, upcoming: Circle, skipped: MinusCircle } as const;
const STEP_NOTE = { done: 'Done', current: 'Up next', upcoming: 'Coming up', skipped: 'Not needed' } as const;

function Unavailable() {
  return (
    <div className="ox-portal-page">
      <section className="ox-portal-hero is-muted">
        <span className="ox-portal-hero-icon"><LockKeyhole className="size-6" aria-hidden /></span>
        <h1>This private link isn’t active</h1>
        <p>It may have expired or been turned off. Ask your agent for a fresh link — it only takes a moment.</p>
      </section>
    </div>
  );
}

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isPortalToken(token)) return <Unavailable />;
  const snapshot = await openClientPortal(token).catch(() => undefined);
  if (!snapshot) return <Unavailable />;
  const now = new Date();
  const view = portalView(snapshot, now);
  const expires = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(snapshot.expiresAt));

  return (
    <div className="ox-portal-page">
      <p className="ox-portal-prepared">Prepared for {snapshot.audience}{snapshot.agentName ? <> by <strong>{snapshot.agentName}</strong></> : null}</p>
      <section className={`ox-portal-hero is-${snapshot.status}`} aria-labelledby="portal-headline">
        <span className="ox-portal-hero-icon">{snapshot.status === 'closed' ? <KeyRound className="size-6" aria-hidden /> : <Home className="size-6" aria-hidden />}</span>
        <p className="ox-portal-address">{snapshot.propertyAddress}</p>
        <h1 id="portal-headline">{view.headline}</h1>
        <p className="ox-portal-subline">{view.subline}</p>
        {view.daysToClose !== undefined ? (
          <div className="ox-portal-countdown" aria-hidden>
            <strong>{view.daysToClose}</strong><span>{view.daysToClose === 1 ? 'day' : 'days'}</span>
          </div>
        ) : null}
      </section>

      {view.next && snapshot.status !== 'closed' ? (
        <section className="ox-portal-next" aria-label="What’s next">
          <p className="ox-eyebrow">What’s next</p>
          <p className="ox-portal-next-title">{view.next.label}</p>
          {stepDate(view.next) ? <p className="ox-portal-next-date">{stepDate(view.next)}</p> : null}
        </section>
      ) : null}

      <section className="ox-portal-timeline" aria-labelledby="portal-timeline">
        <h2 id="portal-timeline">Your timeline</h2>
        <ol>
          {view.steps.map((step, index) => {
            const Icon = STEP_ICON[step.state];
            return (
              <li key={`${step.label}-${index}`} className={`is-${step.state}`}>
                <span className="ox-portal-dot"><Icon className="size-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="ox-portal-step-title">{step.label}</p>
                  <p className="ox-portal-step-meta"><span>{STEP_NOTE[step.state]}</span>{stepDate(step) ? <span> · {stepDate(step)}</span> : null}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="ox-portal-footer">
        <p><LockKeyhole className="inline size-3.5 align-[-2px]" aria-hidden /> Private page · updates automatically · link open until {expires}</p>
        <p>Questions? Reply to your agent directly — this page is read-only.</p>
      </footer>
    </div>
  );
}
