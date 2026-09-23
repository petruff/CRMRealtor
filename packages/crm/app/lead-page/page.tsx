import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, Inbox, Megaphone, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { LeadPageCreate, LeadPageShare } from '@/components/lead-page-share';
import { PageHeader } from '@/components/page-header';
import { siteOrigin } from '@/lib/application/site-origin';
import { getRepository } from '@/lib/data';
import { countLeadPageSubmissions, listLeadPages, type LeadPageSummary } from '@/lib/data/lead-page-repository';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createLeadPageAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Lead page', description: 'A simple page and QR code that sends every inquiry straight into Omnix.' };

const USES = [
  ['Instagram & Facebook bio', 'bio'],
  ['Email signature', 'email'],
  ['Yard signs & flyers (QR)', 'print'],
  ['Business cards (QR)', 'card'],
] as const;

export default async function LeadPageSetup() {
  const context = await getRepository();
  let page: LeadPageSummary | undefined;
  let leads = 0;
  let workspaceName = 'Your Omnix agent';
  if (context.isLive) {
    const client = await createSupabaseServerClient();
    page = (await listLeadPages(client, context.workspaceScope.workspaceId).catch(() => [])).find((item) => item.enabled);
    if (page) leads = await countLeadPageSubmissions(client, context.workspaceScope.workspaceId, page.endpointKey).catch(() => 0);
    const { data } = await client.from('workspaces').select('name').eq('id', context.workspaceScope.workspaceId).maybeSingle();
    if (data?.name) workspaceName = String(data.name);
  }
  const origin = (await siteOrigin()).replace(/\/$/u, '');
  const url = page ? `${origin}/l/${page.endpointKey}` : undefined;
  const qrSvg = url ? await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#ffffff' } }) : '';
  const isOwner = context.workspaceScope.role === 'owner';

  return (
    <div className="ox-stack ox-narrow">
      <PageHeader eyebrow="Lead page" title="Your always-on inquiry page"
        description="One link and QR code for your bio, signs and cards. Every inquiry lands in Omnix as a new lead — with an instant alert and a follow-up task." />
      <section className="ox-card" aria-labelledby="lead-page-link">
        <header className="ox-card-header">
          <span className="ox-icon-chip ox-tone-task"><QrCode className="size-4" aria-hidden /></span>
          <h2 id="lead-page-link" className="ox-card-title">{url ? 'Share your page' : 'Create your page'}</h2>
          {url ? <span className="ox-count" title="Inquiries received">{leads}</span> : null}
        </header>
        <div className="ox-lead-body">
          {url ? (
            <LeadPageShare url={url} qrSvg={qrSvg} agentName={workspaceName} />
          ) : isOwner || !context.isLive ? (
            <LeadPageCreate action={createLeadPageAction} />
          ) : (
            <p className="text-sm text-muted">Ask the workspace owner to create the lead page.</p>
          )}
        </div>
      </section>
      <section className="ox-card" aria-labelledby="lead-page-uses">
        <header className="ox-card-header">
          <span className="ox-icon-chip ox-tone-reply"><Megaphone className="size-4" aria-hidden /></span>
          <h2 id="lead-page-uses" className="ox-card-title">Where to use it</h2>
        </header>
        <div className="ox-lead-body grid gap-4">
          <ul className="ox-lead-uses">
            {USES.map(([label, src]) => (
              <li key={src}><Inbox className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{label}{url ? <> — add <code>?src={src}</code> to see which one works best</> : null}</span></li>
            ))}
          </ul>
          <p className="text-sm text-muted">Visitors choose whether you may text or email them — Omnix records their consent with every lead.</p>
          <Link href="/l/preview" className="sk-secondary-button w-fit" target="_blank"><Eye className="size-4" aria-hidden />Preview the page</Link>
        </div>
      </section>
    </div>
  );
}
