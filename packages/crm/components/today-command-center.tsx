import {
  CalendarDays,
  CircleDot,
  Clock3,
  Gift,
  ShieldCheck,
  Upload,
  UserRoundPlus,
} from 'lucide-react';
import type { AlertCenterProps } from '@/components/alert-center';
import { ContactCard } from '@/components/contact-card';
import { TodayFocusTimeline } from '@/components/today-focus-timeline';
import { TodayQueueDisclosure } from '@/components/today-queue-disclosure';
import { TodayMetricLedger, TodayVisualDashboard } from '@/components/today-visual-dashboard';
import { TodayOperatingBriefing } from '@/components/today-operating-briefing';
import { ActionLink, GroupedSurface } from '@/components/ui';
import type { TodayOperatingProjection } from '@/lib/application/today-operating-projection';
import { ensureNextTouch } from '@/lib/domain/cadence';
import { displayName, type Contact } from '@/lib/domain/contact';
import { buildTriage, summarise } from '@/lib/domain/triage';

export function preferredGreetingName(displayName?: string): string | undefined {
  const normalized = displayName?.trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.split(' ')[0]?.slice(0, 120);
}

export function todayDateContext(now: Date, timeZone: string): { greeting: string; dateLabel: string } {
  const hourPart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hourCycle: 'h23', timeZone,
  }).formatToParts(now).find((part) => part.type === 'hour')?.value;
  const hour = Number(hourPart ?? 12);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone,
  }).format(now);
  if (hour < 12) return { greeting: 'Good morning', dateLabel };
  if (hour < 17) return { greeting: 'Good afternoon', dateLabel };
  return { greeting: 'Good evening', dateLabel };
}

export function TodayCommandCenter({
  alerts,
  contacts: storedContacts,
  userDisplayName,
  timeZone = 'America/New_York',
  historicalImportContactIds = new Set<string>(),
  operatingProjection,
}: {
  alerts: AlertCenterProps;
  contacts: readonly Contact[];
  userDisplayName?: string;
  timeZone?: string;
  historicalImportContactIds?: ReadonlySet<string>;
  operatingProjection?: TodayOperatingProjection;
}) {
  const now = new Date(alerts.asOf);
  const { greeting, dateLabel } = todayDateContext(now, timeZone);
  const greetingName = preferredGreetingName(userDisplayName);
  const contacts = storedContacts.map((contact) => ensureNextTouch(contact, now));
  const buckets = buildTriage(contacts, now, { historicalImportContactIds });
  const summary = summarise(buckets);
  const headline = summary.needsAttentionNow === 0
    ? 'Nothing needs you right now.'
    : `${summary.needsAttentionNow} ${summary.needsAttentionNow === 1 ? 'person needs' : 'people need'} you today.`;
  const formattedAsOf = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone,
  });
  const celebrations = buckets.find((bucket) => bucket.id === 'celebrations');
  const contactNames = Object.fromEntries(contacts.map((contact) => [contact.id, displayName(contact)]));
  const attentionRows = [
    { label: 'First contact', value: buckets.find((bucket) => bucket.id === 'needs-first-contact')?.entries.length ?? 0, icon: UserRoundPlus, tone: 'text-hot bg-hot-soft' },
    { label: 'Overdue', value: summary.overdueCount, icon: Clock3, tone: 'text-warm bg-warm-soft' },
    { label: 'Due today', value: summary.dueTodayCount, icon: CalendarDays, tone: 'text-accent bg-accent-soft' },
    { label: 'Relationship moments', value: summary.celebrationCount, icon: Gift, tone: 'text-nurture bg-nurture-soft' },
  ] as const;
  const attentionPanel = (
    <section className="today-command-side today-command-attention" aria-labelledby="attention-balance-title">
      <div className="today-command-side-heading">
        <div>
          <p className="eyebrow">Attention balance</p>
          <h2 id="attention-balance-title" className="mt-1 font-display text-2xl text-ink">What needs you most</h2>
        </div>
        <span className="tabular font-display text-4xl text-ink" aria-label={`${summary.needsAttentionNow} total items need attention`}>{summary.needsAttentionNow}</span>
      </div>
      <ul className="mt-5 grid gap-1">
        {attentionRows.map(({ label, value, icon: Icon, tone }) => (
          <li key={label} className="today-balance-row">
            <span className={`today-balance-icon ${tone}`}><Icon className="size-4" aria-hidden /></span>
            <span className="flex-1 text-sm font-medium text-ink">{label}</span>
            <strong className="tabular text-xl font-medium text-ink">{value}</strong>
          </li>
        ))}
      </ul>
      <ActionLink href="/alerts" className="mt-5 w-full">Open current alerts</ActionLink>
    </section>
  );
  const momentsPanel = (
    <section className="today-command-side today-command-moments" aria-labelledby="relationship-moments-title">
      <div>
        <p className="eyebrow">Relationship moments</p>
        <h2 id="relationship-moments-title" className="mt-1 font-display text-2xl text-ink">Reasons to reach out</h2>
      </div>
      {celebrations?.entries.length ? (
        <GroupedSurface className="today-moments-list mt-5 grid gap-px">
          {celebrations.entries.slice(0, 3).map((entry) => (
            <ContactCard key={`moment-${entry.contact.id}-${entry.reason}`} entry={entry} compact />
          ))}
        </GroupedSurface>
      ) : (
        <div className="today-moments-empty mt-5">
          <Gift className="size-5 text-nurture" aria-hidden />
          <p className="mt-3 text-sm font-medium text-ink">No moments are approaching.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Stored dates will surface birthdays and homeaversaries here.</p>
        </div>
      )}
      <ActionLink href="/contacts" className="mt-5 w-full">Review relationships</ActionLink>
    </section>
  );

  return (
    <div className="today-studio">
      <header className="today-studio-header">
        <div>
          <p className="eyebrow">
            {dateLabel}
          </p>
          <h1 className="today-studio-title">
            {greeting}{greetingName ? `, ${greetingName}` : ''}.
          </h1>
          <p className="today-studio-subtitle">Here&apos;s your day, in order.</p>
          <p className="sr-only">{headline}</p>
        </div>
        <div className="today-evidence-mark">
          <ShieldCheck className="size-5 text-nurture" aria-hidden />
          <span>{alerts.dataMode === 'sample' ? 'Sample CRM view' : alerts.availability === 'available' ? 'Live CRM view' : alerts.availability === 'partial' ? 'Partial CRM view' : 'CRM view unavailable'}</span>
          <small>{alerts.dataMode === 'sample' ? 'Made-up contacts for preview only' : alerts.availability === 'available' ? 'Based on your saved details' : alerts.availability === 'partial' ? 'Some details are unavailable' : 'Your stored work remains protected'}</small>
        </div>
      </header>

      {contacts.length === 0 ? (
        <section className="today-zero-stage" aria-labelledby="today-zero-title">
          <div className="today-zero-copy">
            <span className="today-zero-icon"><ShieldCheck className="size-6" aria-hidden /></span>
            <p className="eyebrow">Your workspace is ready</p>
            <h2 id="today-zero-title" className="mt-2 max-w-3xl font-display text-4xl leading-tight text-ink sm:text-5xl">
              Bring the relationships in. Omnix will put the day in order.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">
              This {alerts.dataMode === 'live' ? 'live workspace' : 'sample workspace'} has no stored contacts yet. Add one person or import the existing book of business; alerts only appear after real CRM facts match a rule.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ActionLink href="/contacts/import" variant="primary"><Upload className="size-4" aria-hidden /> Import contacts</ActionLink>
              <ActionLink href="/contacts/new"><UserRoundPlus className="size-4" aria-hidden /> Add one contact</ActionLink>
              <ActionLink href="/connections">Review connections</ActionLink>
            </div>
          </div>
          <div className="today-zero-proof" aria-label="What happens next">
            <p className="eyebrow">What Omnix will organize</p>
            <ol className="mt-5 grid gap-4">
              <li><span>01</span><div><strong>First contact</strong><small>New relationships that still need a personal response.</small></div></li>
              <li><span>02</span><div><strong>Follow-up rhythm</strong><small>Overdue, due today, and next-seven-day work.</small></div></li>
              <li><span>03</span><div><strong>Relationship moments</strong><small>Birthdays and homeaversaries backed by stored dates.</small></div></li>
            </ol>
            <p className="mt-6 text-xs leading-relaxed text-subtle">No predictions, invented opportunities, or provider claims. Only authorized CRM evidence.</p>
          </div>
        </section>
      ) : (
        <>
          <TodayMetricLedger contacts={contacts} summary={summary} />

          {operatingProjection && <TodayOperatingBriefing projection={operatingProjection} />}

          <TodayFocusTimeline
            {...alerts}
            formattedAsOf={formattedAsOf}
            contactNames={contactNames}
            attentionPanel={attentionPanel}
            momentsPanel={momentsPanel}
          />

          <TodayVisualDashboard contacts={contacts} />

          <section className="today-status-strip" aria-labelledby="today-status-title">
        <CircleDot className="size-5 text-nurture" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="today-status-title" className="text-sm font-medium text-ink">Today is based on authorized CRM evidence</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{alerts.alerts.length} tracked {alerts.alerts.length === 1 ? 'alert' : 'alerts'} across the current planning horizon · {alerts.dataMode === 'live' ? 'Live workspace' : 'Sample workspace'} · No prediction or inferred deadline</p>
        </div>
        <nav aria-label="Today quick actions" className="flex flex-wrap gap-2">
          <ActionLink href="/activities">Tasks</ActionLink>
          <ActionLink href="/approvals">Approvals</ActionLink>
          <ActionLink href="/transactions">Deadlines</ActionLink>
          <ActionLink href="/contacts/import">Import</ActionLink>
          <ActionLink href="/contacts/new" variant="primary">Add contact</ActionLink>
        </nav>
          </section>
        </>
      )}

      <TodayQueueDisclosure contacts={contacts} buckets={buckets} />
    </div>
  );
}
