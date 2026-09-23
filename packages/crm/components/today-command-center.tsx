import Link from 'next/link';
import {
  ArrowRight, BookOpenText, CalendarClock, CheckCircle2, ClipboardCheck, Gift, House,
  MessageCircleReply, MessageSquare, NotebookPen, Phone, Sparkles, Upload, UserRoundPlus, Zap,
} from 'lucide-react';
import type { AlertCenterProps } from '@/components/alert-center';
import { TodayQueueDisclosure } from '@/components/today-queue-disclosure';
import { WhatsNew } from '@/components/whats-new';
import { Avatar, LeadBadge } from '@/components/ui';
import { buildFocusMoments, buildFocusQueue, type FocusItem } from '@/lib/application/focus-queue';
import type { TodayOperatingProjection } from '@/lib/application/today-operating-projection';
import { ensureNextTouch } from '@/lib/domain/cadence';
import type { Contact } from '@/lib/domain/contact';
import { buildTriage } from '@/lib/domain/triage';

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

const FOCUS_VISIBLE = 6;

function listPhrase(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** One sentence that tells her the shape of the day. */
export function daySummary(queueLength: number, projection?: TodayOperatingProjection): string {
  const parts: string[] = [];
  if (queueLength) parts.push(`${queueLength} ${queueLength === 1 ? 'person' : 'people'} to reach`);
  if (projection?.replies.count) parts.push(`${projection.replies.count} ${projection.replies.count === 1 ? 'reply' : 'replies'} waiting`);
  if (projection?.deadlines.count) parts.push(`${projection.deadlines.count} open ${projection.deadlines.count === 1 ? 'deadline' : 'deadlines'}`);
  if (!parts.length) return 'Nothing urgent today — a good day to nurture your sphere.';
  const sentence = listPhrase(parts);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function FocusRow({ item, position }: { item: FocusItem; position: number }) {
  const profile = `/contacts/${encodeURIComponent(item.contactId)}`;
  return (
    <li className="ox-focus-row">
      <span className="ox-focus-rank" aria-hidden>{position}</span>
      <Avatar initials={item.initials} leadType={item.leadType} relationship={item.relationship} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={profile} className="ox-focus-name">{item.name}</Link>
          <LeadBadge leadType={item.leadType} relationship={item.relationship} />
        </div>
        <p className={`ox-focus-why is-${item.kind}`}>{item.why}</p>
        {item.context ? <p className="ox-focus-context">{item.context}</p> : null}
      </div>
      <div className="ox-focus-actions">
        {item.phone ? (
          <>
            <a href={`tel:${item.phone}`} data-call-contact={item.contactId} data-call-name={item.name} className="ox-action-button is-primary" aria-label={`Call ${item.name}`} title={`Call ${item.phone}`}>
              <Phone className="size-4" aria-hidden /><span>Call</span>
            </a>
            <a href={`sms:${item.phone}`} className="ox-action-button" aria-label={`Text ${item.name}`} title="Text">
              <MessageSquare className="size-4" aria-hidden /><span className="sr-only">Text</span>
            </a>
          </>
        ) : null}
        <Link href={`${profile}/brief`} className="ox-action-button max-sm:hidden" aria-label={`Brief me on ${item.name}`} title="One-minute brief">
          <BookOpenText className="size-4" aria-hidden /><span className="sr-only">Brief</span>
        </Link>
        <Link href={`${profile}/outcome`} className="ox-action-button" aria-label={`Log a conversation with ${item.name}`} title="Log what happened">
          <NotebookPen className="size-4" aria-hidden /><span className="sr-only">Log</span>
        </Link>
      </div>
    </li>
  );
}

function WaitingRow({ icon: Icon, label, value, detail, href, tone }: {
  icon: typeof MessageCircleReply; label: string; value: number | '—'; detail?: string; href: string; tone: string;
}) {
  return (
    <li>
      <Link href={href} className="ox-list-row">
        <span className={`ox-icon-chip ${tone}`}><Icon className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="ox-row-title">{label}</span>
          {detail ? <span className="ox-row-detail">{detail}</span> : null}
        </span>
        <span className="ox-stat-value" aria-label={`${value} ${label.toLowerCase()}`}>{value}</span>
      </Link>
    </li>
  );
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
  const queue = buildFocusQueue(buckets, now);
  const moments = buildFocusMoments(buckets, now);
  const visible = queue.slice(0, FOCUS_VISIBLE);
  const pipeline = {
    appointments: contacts.filter((contact) => contact.pipelineStage === 'appointment-set').length,
    active: contacts.filter((contact) => contact.pipelineStage === 'active').length,
    underContract: contacts.filter((contact) => contact.pipelineStage === 'under-contract').length,
  };
  const temperature = {
    hot: contacts.filter((contact) => contact.leadType === 'hot').length,
    warm: contacts.filter((contact) => contact.leadType === 'warm').length,
    nurture: contacts.filter((contact) => contact.leadType === 'nurture').length,
  };
  const temperatureTotal = Math.max(1, temperature.hot + temperature.warm + temperature.nurture);
  const count = (state: 'available' | 'unavailable' | undefined, value: number | undefined): number | '—' =>
    state === 'available' && value !== undefined ? value : '—';

  return (
    <div className="ox-today">
      {contacts.length ? <WhatsNew /> : null}
      <header className="ox-today-hero">
        <div className="min-w-0">
          <p className="ox-eyebrow">{dateLabel}</p>
          <h1 className="ox-today-greeting">{greeting}{greetingName ? `, ${greetingName}` : ''}.</h1>
          <p className="ox-today-summary">{contacts.length ? daySummary(queue.length, operatingProjection) : 'Your workspace is ready for its first relationships.'}</p>
        </div>
        {contacts.length ? (
          <div className="ox-today-cta">
            {queue.length ? (
              <Link href="/power-hour" className="sk-primary-button ox-cta-primary">
                <Zap className="size-4" aria-hidden /> Start Power Hour
                <span className="ox-cta-count" aria-label={`${queue.length} people`}>{queue.length}</span>
              </Link>
            ) : null}
            <Link href="/capture" className="sk-secondary-button"><NotebookPen className="size-4" aria-hidden /> Log a conversation</Link>
          </div>
        ) : null}
      </header>

      {alerts.dataMode === 'live' && alerts.availability !== 'available' ? (
        <p role="status" className="ox-inline-notice">Some details could not be loaded. Everything shown is from your saved records.</p>
      ) : null}

      {contacts.length === 0 ? (
        <section className="ox-card ox-first-run" aria-labelledby="today-zero-title">
          <span className="ox-empty-hero-icon is-accent"><Sparkles className="size-6" aria-hidden /></span>
          <h2 id="today-zero-title">Bring your relationships in.</h2>
          <p>Import your phone, spreadsheet, Mailchimp or old CRM. Omnix puts the day in order: new leads first, then overdue follow-ups, then birthdays and home anniversaries worth a call.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/contacts/import" className="sk-primary-button"><Upload className="size-4" aria-hidden /> Import contacts</Link>
            <Link href="/contacts/new" className="sk-secondary-button"><UserRoundPlus className="size-4" aria-hidden /> Add one person</Link>
          </div>
        </section>
      ) : (
        <div className="ox-today-grid">
          <section className="ox-card ox-focus" aria-labelledby="focus-title">
            <header className="ox-card-header">
              <span className="ox-icon-chip ox-tone-alert"><Phone className="size-4" aria-hidden /></span>
              <h2 id="focus-title" className="ox-card-title">Reach out now</h2>
              <span className="ox-count" aria-label={`${queue.length} people`}>{queue.length}</span>
            </header>
            {visible.length ? (
              <>
                <p className="ox-card-caption">New leads first, then the longest overdue, then today&apos;s follow-ups.</p>
                <ol className="ox-focus-list">
                  {visible.map((item, index) => <FocusRow key={item.contactId} item={item} position={index + 1} />)}
                </ol>
                {queue.length > visible.length ? (
                  <Link href="/power-hour" className="ox-card-footer-link">Work all {queue.length} in Power Hour <ArrowRight className="size-4" aria-hidden /></Link>
                ) : null}
              </>
            ) : (
              <div className="ox-card-empty is-stacked">
                <CheckCircle2 className="size-6 text-nurture" aria-hidden />
                <p className="font-medium text-ink">Everyone is reached and on schedule.</p>
                <p>Use the time for a moment below, or log a conversation you just had.</p>
              </div>
            )}
          </section>

          <aside className="ox-today-side" aria-label="Today at a glance">
            <section className="ox-card" aria-labelledby="waiting-title">
              <header className="ox-card-header">
                <h2 id="waiting-title" className="ox-card-title">Waiting on you</h2>
                <Link href="/inbox" className="ox-text-link">Inbox <ArrowRight className="size-3.5" aria-hidden /></Link>
              </header>
              <ul className="ox-list">
                <WaitingRow icon={MessageCircleReply} label="Replies" tone="ox-tone-reply" href="/inbox"
                  value={count(operatingProjection?.replies.state, operatingProjection?.replies.count)} detail={operatingProjection?.replies.topLabel ? `From ${operatingProjection.replies.topLabel}` : undefined} />
                <WaitingRow icon={ClipboardCheck} label="Approvals" tone="ox-tone-approval" href="/approvals"
                  value={count(operatingProjection?.approvals.state, operatingProjection?.approvals.count)} detail={operatingProjection?.approvals.topLabel} />
                <WaitingRow icon={CalendarClock} label="Deal deadlines" tone="ox-tone-task" href="/transactions"
                  value={count(operatingProjection?.deadlines.state, operatingProjection?.deadlines.count)}
                  detail={operatingProjection?.deadlines.overdue ? `${operatingProjection.deadlines.overdue} past due` : operatingProjection?.deadlines.topLabel} />
              </ul>
            </section>

            <section className="ox-card" aria-labelledby="moments-title">
              <header className="ox-card-header">
                <span className="ox-icon-chip ox-tone-task"><Gift className="size-4" aria-hidden /></span>
                <h2 id="moments-title" className="ox-card-title">Moments to celebrate</h2>
                <Link href="/sphere" className="ox-text-link">Drafts ready <ArrowRight className="size-3.5" aria-hidden /></Link>
              </header>
              {moments.length ? (
                <ul className="ox-list">
                  {moments.map((moment) => (
                    <li key={`${moment.contactId}-${moment.kind}`}>
                      <Link href={`/contacts/${encodeURIComponent(moment.contactId)}`} className="ox-list-row">
                        <Avatar initials={moment.initials} leadType={moment.leadType} relationship={moment.relationship} />
                        <span className="min-w-0 flex-1">
                          <span className="ox-row-title">{moment.name}</span>
                          <span className="ox-row-detail">{moment.kind === 'birthday' ? '🎂' : '🏡'} {moment.label}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ox-card-empty">No birthdays or home anniversaries in the next two weeks.</p>
              )}
            </section>

            <section className="ox-card" aria-labelledby="pulse-title">
              <header className="ox-card-header">
                <span className="ox-icon-chip ox-tone-reply"><House className="size-4" aria-hidden /></span>
                <h2 id="pulse-title" className="ox-card-title">Business pulse</h2>
                <Link href="/insights" className="ox-text-link">Insights <ArrowRight className="size-3.5" aria-hidden /></Link>
              </header>
              <dl className="ox-pulse-grid">
                <div><dt>Appointments</dt><dd>{pipeline.appointments}</dd></div>
                <div><dt>Working</dt><dd>{pipeline.active}</dd></div>
                <div><dt>Under contract</dt><dd>{pipeline.underContract}</dd></div>
              </dl>
              <div className="ox-temperature" aria-label={`${temperature.hot} hot, ${temperature.warm} warm, ${temperature.nurture} nurture relationships`}>
                <div className="ox-temperature-bar" aria-hidden>
                  <span className="bg-hot" style={{ width: `${(temperature.hot / temperatureTotal) * 100}%` }} />
                  <span className="bg-warm" style={{ width: `${(temperature.warm / temperatureTotal) * 100}%` }} />
                  <span className="bg-nurture" style={{ width: `${(temperature.nurture / temperatureTotal) * 100}%` }} />
                </div>
                <p><span className="text-hot">{temperature.hot} Hot</span> · <span className="text-warm">{temperature.warm} Warm</span> · <span className="text-nurture">{temperature.nurture} Nurture</span></p>
              </div>
            </section>
          </aside>
        </div>
      )}

      {contacts.length ? <TodayQueueDisclosure contacts={contacts} buckets={buckets} /> : null}
    </div>
  );
}
