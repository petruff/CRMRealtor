import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ReviveLeads } from '@/components/revive-leads';
import { getRepository } from '@/lib/data';
import { buildReviveBatch } from '@/lib/application/revive-leads';
import { markRevivedAction, stopEmailsAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Revive old leads', description: 'A short daily batch of personal emails to leads who were never worked.' };

export default async function RevivePage() {
  const context = await getRepository();
  const now = new Date();
  const contacts = await context.repository.list();
  const batch = buildReviveBatch({ contacts, now, ...(context.userDisplayName ? { agentName: context.userDisplayName } : {}) });
  const timeZone = process.env.OMNIX_TIME_ZONE ?? 'America/New_York';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return (
    <div className="ox-stack ox-narrow">
      <PageHeader eyebrow="Revive old leads" title="Ten personal emails a day"
        description="Leads you imported or captured but never worked. Omnix writes a short, personal first email for each — you send it from your own email and tap Mark sent." />
      <ReviveLeads items={batch.items} eligible={batch.eligible} day={day} markSent={markRevivedAction} stopEmails={stopEmailsAction} />
      <p className="flex gap-2 text-xs leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        Only contacts subscribed to email are included, and every draft tells them how to opt out. If someone asks to stop, tap “Asked to stop” and they won’t be emailed again. Include your brokerage’s mailing address in your email signature.
      </p>
    </div>
  );
}
