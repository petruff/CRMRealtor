import type { Metadata } from 'next';
import Link from 'next/link';
import { Gift, HeartHandshake, Home, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SphereMessageCard } from '@/components/sphere-message-card';
import { buildReferralEngine } from '@/lib/application/referral-engine';
import { getRepository } from '@/lib/data';
import { markSphereMessageSentAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Referral engine', description: 'Stay top of mind with past clients and your sphere.' };

export default async function SpherePage() {
  const context = await getRepository();
  const contacts = await context.repository.list();
  const engine = buildReferralEngine(contacts, new Date(), context.userDisplayName);
  const { pulse } = engine;

  return (
    <div className="ox-stack">
      <PageHeader
        eyebrow="Referral engine"
        title="Your sphere, warm all year"
        description="Most of your business comes from people who already trust you. Here is who to celebrate, who has gone quiet, and a personal note ready for each."
      />

      <section className="ox-card" aria-label="Sphere pulse">
        <dl className="ox-pulse-grid is-flush">
          <div><dt>Past clients &amp; sphere</dt><dd>{pulse.size}</dd></div>
          <div><dt>Touched in 90 days</dt><dd>{pulse.touchedShare}%</dd></div>
          <div><dt>Referrals received</dt><dd>{pulse.referralsReceived}</dd></div>
        </dl>
        <div className="ox-temperature" aria-label={`${pulse.touchedRecently} of ${pulse.size} touched in the last 90 days`}>
          <div className="ox-temperature-bar" aria-hidden><span className="bg-nurture" style={{ width: `${pulse.touchedShare}%` }} /></div>
          <p className="text-muted">{pulse.size ? `${pulse.touchedRecently} of ${pulse.size} heard from you in the last 90 days. Aim for everyone, every quarter.` : 'Mark contacts as Past client or Sphere to build your referral engine.'}</p>
        </div>
      </section>

      <section aria-labelledby="moments-title" className="ox-sphere-section">
        <header className="ox-sphere-section-header">
          <span className="ox-icon-chip ox-tone-approval"><Gift className="size-4" aria-hidden /></span>
          <div><h2 id="moments-title" className="ox-card-title">Moments in the next 30 days</h2><p className="ox-row-detail">Home anniversaries and birthdays — the easiest reasons to reach out.</p></div>
          <span className="ox-count">{engine.moments.length}</span>
        </header>
        {engine.moments.length ? (
          <div className="ox-sphere-grid">
            {engine.moments.map((moment) => (
              <SphereMessageCard key={moment.id} contactId={moment.contactId} name={moment.name} initials={moment.initials} label={moment.label}
                kind={moment.kind} phone={moment.phone} email={moment.email} drafts={moment.drafts} tone="celebrate"
                action={markSphereMessageSentAction.bind(null, moment.contactId)} />
            ))}
          </div>
        ) : <p className="ox-card ox-card-empty">No birthdays or home anniversaries in the next 30 days. Add them on a contact to never miss one.</p>}
      </section>

      <section aria-labelledby="quiet-title" className="ox-sphere-section">
        <header className="ox-sphere-section-header">
          <span className="ox-icon-chip ox-tone-reply"><Home className="size-4" aria-hidden /></span>
          <div><h2 id="quiet-title" className="ox-card-title">Past clients gone quiet</h2><p className="ox-row-detail">No conversation in 90+ days. A friendly check-in with a market update keeps you their agent for life.</p></div>
          <span className="ox-count">{engine.checkIns.length}</span>
        </header>
        {engine.checkIns.length ? (
          <div className="ox-sphere-grid">
            {engine.checkIns.map((moment) => (
              <SphereMessageCard key={moment.id} contactId={moment.contactId} name={moment.name} initials={moment.initials} label={moment.label}
                kind={moment.kind} phone={moment.phone} email={moment.email} drafts={moment.drafts} tone="quiet"
                action={markSphereMessageSentAction.bind(null, moment.contactId)} />
            ))}
          </div>
        ) : <p className="ox-card ox-card-empty"><Sparkles className="inline size-4 align-[-3px] text-nurture" aria-hidden /> Every past client has heard from you this quarter.</p>}
      </section>

      <section aria-labelledby="referrers-title" className="ox-sphere-section">
        <header className="ox-sphere-section-header">
          <span className="ox-icon-chip ox-tone-task"><HeartHandshake className="size-4" aria-hidden /></span>
          <div><h2 id="referrers-title" className="ox-card-title">Your top referrers</h2><p className="ox-row-detail">People who sent you business. A quick thank-you makes the next referral more likely.</p></div>
        </header>
        {engine.referrers.length ? (
          <div className="ox-sphere-grid">
            {engine.referrers.map((referrer) => (
              <SphereMessageCard key={referrer.contactId} contactId={referrer.contactId} name={referrer.name} initials={referrer.initials}
                label={`${referrer.referrals} ${referrer.referrals === 1 ? 'referral' : 'referrals'} · ${referrer.referredNames.slice(0, 3).join(', ')}`}
                kind="thank-you" drafts={referrer.drafts} tone="thanks"
                {...(contacts.find((contact) => contact.id === referrer.contactId)?.phone ? { phone: contacts.find((contact) => contact.id === referrer.contactId)?.phone } : {})}
                {...(contacts.find((contact) => contact.id === referrer.contactId)?.email ? { email: contacts.find((contact) => contact.id === referrer.contactId)?.email } : {})}
                action={markSphereMessageSentAction.bind(null, referrer.contactId)} />
            ))}
          </div>
        ) : <p className="ox-card ox-card-empty">When you add a contact, set <strong>Referred by</strong> to see who sends you business. <Link className="ox-text-link" href="/contacts/new">Add a contact</Link></p>}
      </section>
    </div>
  );
}
