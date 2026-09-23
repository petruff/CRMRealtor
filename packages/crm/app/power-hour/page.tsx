import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Mail, MessageSquare, NotebookPen, Phone, SkipForward, Zap } from 'lucide-react';
import { PowerHourStepForm } from '@/components/power-hour-step-form';
import { Avatar, LeadBadge } from '@/components/ui';
import { completePowerHourStepAction } from './actions';
import { buildFocusQueue } from '@/lib/application/focus-queue';
import { parsePowerHourSession, powerHourHref } from '@/lib/application/power-hour-session';
import { getRepository } from '@/lib/data';
import { effectiveCadenceDays, ensureNextTouch } from '@/lib/domain/cadence';
import { INTENT_LABEL, contactAddressLines, displayName } from '@/lib/domain/contact';
import { buildTriage } from '@/lib/domain/triage';
import { formatCalendarDay } from '@/lib/presentation/us-dates';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Power Hour',
  description: 'Work through today’s calls one person at a time.',
};

function money(value?: number): string | undefined {
  return value === undefined ? undefined : `$${value.toLocaleString('en-US')}`;
}

export default async function PowerHourPage({ searchParams }: { searchParams: Promise<{ done?: string; skip?: string }> }) {
  const session = parsePowerHourSession(await searchParams);
  const { repository } = await getRepository();
  const now = new Date();
  const contacts = (await repository.list()).map((contact) => ensureNextTouch(contact, now));
  const queue = buildFocusQueue(buildTriage(contacts, now), now);
  const skipped = new Set(session.skip);
  const remaining = queue.filter((item) => !skipped.has(item.contactId));
  const current = remaining[0];
  const total = session.done + queue.length;
  const progress = total ? Math.round((session.done / total) * 100) : 100;

  const header = (
    <header className="ox-power-header">
      <Link href="/" className="ox-text-link"><ArrowLeft className="size-4" aria-hidden /> End session</Link>
      <div className="ox-power-progress" role="progressbar" aria-label="Power Hour progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="ox-power-count"><strong>{session.done}</strong> done · <strong>{remaining.length}</strong> to go{skipped.size ? ` · ${skipped.size} skipped` : ''}</p>
    </header>
  );

  if (!current) {
    return (
      <div className="ox-power">
        {header}
        <section className="ox-empty-hero" aria-labelledby="power-done-title">
          <span className="ox-empty-hero-icon"><CheckCircle2 className="size-7" aria-hidden /></span>
          <h1 id="power-done-title">{session.done ? 'Power Hour complete.' : 'Nobody is waiting right now.'}</h1>
          <p>
            {session.done
              ? `You reached ${session.done} ${session.done === 1 ? 'person' : 'people'}${skipped.size ? ` and set ${skipped.size} aside for later` : ''}. Every conversation is logged and the next follow-ups are scheduled.`
              : 'New leads, overdue and due-today follow-ups will appear here as they come up.'}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/" className="sk-primary-button">Back to Today</Link>
            {skipped.size ? <Link href={powerHourHref({ done: session.done, skip: [] })} className="sk-secondary-button">Go through skipped</Link> : null}
          </div>
        </section>
      </div>
    );
  }

  const contact = contacts.find((entry) => entry.id === current.contactId)!;
  const [lastNote] = await repository.notesFor(contact.id);
  const cadenceDays = effectiveCadenceDays(contact, now);
  const wants = [
    contact.buyer?.priceMax ? `Budget ${[money(contact.buyer.priceMin), money(contact.buyer.priceMax)].filter(Boolean).join('–')}` : undefined,
    contact.buyer?.areas?.length ? contact.buyer.areas.join(', ') : undefined,
    contact.buyer?.beds ? `${contact.buyer.beds}+ beds` : undefined,
    contact.seller?.propertyAddress ? `Selling ${contact.seller.propertyAddress}` : undefined,
    contact.buyer?.timeline ?? contact.seller?.timeline,
  ].filter(Boolean).join(' · ');
  const address = contactAddressLines(contact).join(', ');
  const nextSkip = [...session.skip, current.contactId];

  return (
    <div className="ox-power">
      {header}
      <article className="ox-card ox-power-card" aria-labelledby="power-name">
        <div className="ox-power-person">
          <Avatar initials={current.initials} leadType={current.leadType} relationship={current.relationship} />
          <div className="min-w-0">
            <p className="ox-eyebrow"><Zap className="inline size-3.5" aria-hidden /> Person {session.done + 1} of {total}</p>
            <h1 id="power-name" className="ox-power-name">{displayName(contact)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <LeadBadge leadType={contact.leadType} relationship={contact.relationship} />
              <span className="text-sm text-muted">{INTENT_LABEL[contact.intent]}</span>
            </div>
          </div>
        </div>
        <p className={`ox-power-why ox-focus-why is-${current.kind}`}>{current.why}</p>

        <dl className="ox-power-facts">
          <div><dt>Phone</dt><dd>{contact.phone ?? <span className="text-subtle">Not provided</span>}</dd></div>
          <div><dt>Last spoke</dt><dd>{contact.lastContactedAt ? formatCalendarDay(contact.lastContactedAt, now) : 'Never'}</dd></div>
          {wants ? <div className="is-wide"><dt>Looking for</dt><dd>{wants}</dd></div> : null}
          {address ? <div className="is-wide"><dt>Address</dt><dd>{address}</dd></div> : null}
          {lastNote ? <div className="is-wide"><dt>Last note · {formatCalendarDay(lastNote.createdAt, now)}</dt><dd className="whitespace-pre-wrap">{lastNote.body}</dd></div> : null}
        </dl>

        <div className="ox-power-contact">
          {contact.phone ? <a href={`tel:${contact.phone}`} className="sk-primary-button"><Phone className="size-4" aria-hidden /> Call</a> : null}
          {contact.phone ? <a href={`sms:${contact.phone}`} className="sk-secondary-button"><MessageSquare className="size-4" aria-hidden /> Text</a> : null}
          {contact.email ? <a href={`mailto:${contact.email}`} className="sk-secondary-button"><Mail className="size-4" aria-hidden /> Email</a> : null}
          <Link href={`/contacts/${encodeURIComponent(contact.id)}/outcome`} className="sk-secondary-button"><NotebookPen className="size-4" aria-hidden /> Full outcome</Link>
        </div>

        <PowerHourStepForm
          action={completePowerHourStepAction.bind(null, contact.id)}
          sessionDone={session.done}
          sessionSkip={session.skip.join(',')}
          cadenceLabel={cadenceDays ? `${cadenceDays} days` : 'paused'}
        />
        <div className="ox-power-footer">
          <Link href={powerHourHref({ done: session.done, skip: nextSkip })} className="ox-text-link"><SkipForward className="size-4" aria-hidden /> Skip for now</Link>
          <Link href={`/contacts/${encodeURIComponent(contact.id)}`} className="ox-text-link">Open full profile</Link>
        </div>
      </article>
    </div>
  );
}
