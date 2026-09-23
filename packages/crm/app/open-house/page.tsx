import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import { OpenHouseSetup } from '@/components/open-house-setup';
import { PageHeader } from '@/components/page-header';
import { Avatar, LeadBadge } from '@/components/ui';
import { openHouseVisitors } from '@/lib/application/open-house-commands';
import { getRepository } from '@/lib/data';
import { displayName, initials } from '@/lib/domain/contact';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Open house', description: 'Run a sign-in kiosk and follow up with every visitor.' };

export default async function OpenHousePage() {
  const context = await getRepository();
  const timeZone = process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [contacts, properties] = await Promise.all([
    context.repository.list(),
    context.propertyRepository.list(context.workspaceScope, { limit: 50 }).catch(() => []),
  ]);
  const visitors = openHouseVisitors(contacts, today);
  const suggestions = properties
    .filter((property) => !['sold', 'withdrawn', 'off-market'].includes(property.lifecycle))
    .map((property) => [property.addressLine1, property.city, property.stateCode].filter(Boolean).join(', '));

  return (
    <div className="ox-stack ox-narrow">
      <PageHeader eyebrow="Open house" title="Sign in every visitor" description="A calm, branded sign-in on your tablet or phone — then follow up while they still remember the kitchen." />
      <OpenHouseSetup suggestions={suggestions} />
      <section className="ox-card" aria-labelledby="visitors-title">
        <header className="ox-card-header">
          <span className="ox-icon-chip ox-tone-task"><Users className="size-4" aria-hidden /></span>
          <h2 id="visitors-title" className="ox-card-title">Today’s visitors</h2>
          <span className="ox-count">{visitors.length}</span>
        </header>
        {visitors.length ? (
          <>
            <ul className="ox-list">
              {visitors.map((visitor) => (
                <li key={visitor.id}>
                  <Link href={`/contacts/${encodeURIComponent(visitor.id)}`} className="ox-list-row is-person">
                    <Avatar initials={initials(visitor)} leadType={visitor.leadType} relationship={visitor.relationship} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><span className="ox-row-title">{displayName(visitor)}</span><LeadBadge leadType={visitor.leadType} relationship={visitor.relationship} /></span>
                      <span className="ox-row-detail">{visitor.tags.includes('has-agent') ? 'Working with another agent — do not solicit' : [visitor.phone, visitor.email].filter(Boolean).join(' · ')}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/power-hour" className="ox-card-footer-link">Follow up now in Power Hour <ArrowRight className="size-4" aria-hidden /></Link>
          </>
        ) : <p className="ox-card-empty">No sign-ins yet today.</p>}
      </section>
    </div>
  );
}
