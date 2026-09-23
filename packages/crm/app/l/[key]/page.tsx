import type { Metadata } from 'next';
import { Home, LockKeyhole } from 'lucide-react';
import { LeadPageForm } from '@/components/lead-page-form';
import { findPublicLeadPage, serviceClient } from '@/lib/data/lead-page-repository';
import { agentFirstName, isLeadPageKey } from '@/lib/domain/lead-page';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { submitLeadPageAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Let’s talk', robots: { index: false, follow: false }, referrer: 'strict-origin-when-cross-origin' };
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ src?: string }> }) {
  const { key } = await params;
  const { src } = await searchParams;
  let agentName: string | undefined;
  if (key === 'preview' || !isSupabaseConfigured()) {
    agentName = 'Your Omnix agent';
  } else if (isLeadPageKey(key)) {
    const client = serviceClient();
    agentName = client ? (await findPublicLeadPage(client, key).catch(() => undefined))?.agentName : undefined;
  }
  if (!agentName) {
    return (
      <div className="ox-portal-page">
        <section className="ox-portal-hero is-muted">
          <span className="ox-portal-hero-icon"><LockKeyhole className="size-6" aria-hidden /></span>
          <h1>This page isn’t active</h1>
          <p>Please reach out to your agent directly.</p>
        </section>
      </div>
    );
  }
  const agentFirst = agentFirstName(agentName);
  return (
    <div className="ox-portal-page ox-lead-page">
      <header className="ox-lead-header">
        <span className="ox-portal-hero-icon"><Home className="size-6" aria-hidden /></span>
        <p className="ox-portal-prepared">{agentName}</p>
        <h1>Let’s talk about your next move</h1>
        <p className="ox-portal-subline">Buying, selling or just curious — leave a note and {agentFirst} will get back to you personally.</p>
      </header>
      <LeadPageForm action={submitLeadPageAction.bind(null, key)} agentFirstName={agentFirst} {...(src ? { source: src } : {})} />
    </div>
  );
}
