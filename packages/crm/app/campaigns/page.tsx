import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { CheckCircle2, Mail, ShieldCheck, Sparkles, Users, XCircle } from 'lucide-react';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createMailchimpServerRepository } from '@/lib/data/mailchimp-operation-server-context';
import { isCanonicalWorkspaceOwnerScope } from '@/lib/domain/workspace';
import { createCampaignDraftAction, createInMailchimpAction, sendMailchimpCampaignAction,
  updateCampaignDraftAction } from './actions';

export const metadata: Metadata = { title: 'Email campaigns' };

const STATE_LABELS = {
  draft: 'Draft in Omnix', create_approved: 'Creating in Mailchimp', created: 'Ready in Mailchimp',
  send_approved: 'Sending', sent: 'Sent', failed: 'Needs attention',
} as const;

export default async function CampaignsPage({ searchParams }: {
  searchParams: Promise<{ success?: string; error?: string; page?: string }>;
}) {
  const context = await getRepository();
  const query = await searchParams;
  const owner = isCanonicalWorkspaceOwnerScope(context.workspaceScope);
  const mailchimpConnections = context.isLive
    ? await context.connectorRepository.listConnections(context.workspaceScope, { provider: 'mailchimp', limit: 10 }) : [];
  const connection = mailchimpConnections.find((item) => item.status === 'active');
  const page = Math.max(1, Math.min(1_250, Number.parseInt(query.page ?? '1', 10) || 1));
  const pageSize = 8;
  const campaignPage = context.isLive
    ? await createMailchimpServerRepository({ authenticated: await createSupabaseServerClient() }).campaigns
      .list(context.workspaceScope, pageSize + 1, (page - 1) * pageSize)
    : [];
  const hasMore = campaignPage.length > pageSize;
  const campaigns = campaignPage.slice(0, pageSize);

  return <div className="space-y-10">
    <header className="grid gap-5 border-b border-line pb-8 md:grid-cols-[1fr_auto] md:items-end">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Email campaigns</p><h1 className="mt-2 font-display text-4xl text-ink sm:text-5xl">One message. The right audience.</h1><p className="mt-3 max-w-2xl text-base leading-7 text-muted">Create a polished newsletter once, review exactly who is eligible, and send through the connected Mailchimp account.</p></div>
      <div className="flex items-center gap-2 rounded-[var(--sk-card-radius)] border border-line bg-surface-2 px-4 py-3 text-sm text-muted"><ShieldCheck className="size-5 text-nurture" aria-hidden /> Unsubscribed contacts are always excluded</div>
    </header>
    {query.success ? <div role="status" className="rounded-[var(--sk-card-radius)] border border-nurture-border bg-nurture-soft px-4 py-3 text-sm text-nurture">{query.success}</div> : null}
    {query.error ? <div role="alert" className="rounded-[var(--sk-card-radius)] border border-hot-border bg-hot-soft px-4 py-3 text-sm text-hot">{query.error}</div> : null}

    {!connection ? <section className="rounded-[var(--sk-card-radius)] border border-line bg-surface p-6"><h2 className="text-xl font-semibold text-ink">Connect Mailchimp first</h2><p className="mt-2 text-sm text-muted">Campaigns need an active Mailchimp audience with contact sync completed.</p><Link href="/connections" className="mt-5 inline-flex min-h-11 items-center rounded-[var(--sk-control-radius)] bg-accent px-5 text-sm font-semibold text-white">Open connections</Link></section> :
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <form action={createCampaignDraftAction} className="rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-7">
          <input type="hidden" name="connectionId" value={connection.id} />
          <input type="hidden" name="correlationId" value={randomUUID()} />
          <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Sparkles className="size-5" /></span><div><h2 className="text-xl font-semibold text-ink">Create a campaign</h2><p className="mt-1 text-sm text-muted">Omnix prepares a safe draft. Nothing sends yet.</p></div></div>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-ink sm:col-span-2">Audience<select name="segment" required className="min-h-12 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3"><option value="all-subscribers">All subscribed contacts</option><option value="hot">Hot leads</option><option value="warm">Warm leads</option><option value="nurture">Nurture leads</option></select></label>
            <label className="grid gap-2 text-sm font-medium text-ink">Internal campaign name<input name="title" required maxLength={160} className="min-h-12 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" placeholder="September market update" /></label>
            <label className="grid gap-2 text-sm font-medium text-ink">Email subject<input name="subject" required maxLength={150} className="min-h-12 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" placeholder="What changed in the market this month" /></label>
            <label className="grid gap-2 text-sm font-medium text-ink sm:col-span-2">Preview line<input name="previewText" required maxLength={150} className="min-h-12 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" placeholder="A quick update for homeowners and future buyers" /></label>
            <label className="grid gap-2 text-sm font-medium text-ink">From name<input name="fromName" required maxLength={100} defaultValue={owner ? context.userDisplayName : ''} placeholder="Your business name" className="min-h-12 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
            <label className="grid gap-2 text-sm font-medium text-ink">Replies go to<input type="email" name="replyTo" required defaultValue={owner ? context.userEmail : ''} placeholder="you@example.com" className="min-h-12 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
            <label className="grid gap-2 text-sm font-medium text-ink sm:col-span-2">Message<textarea name="message" required maxLength={100000} rows={10} className="min-h-48 resize-y rounded-[var(--sk-control-radius)] border border-control bg-surface p-3 leading-7" placeholder="Write the update Judith wants her contacts to receive…" /></label>
          </div>
          <button type="submit" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--sk-control-radius)] bg-accent px-5 font-semibold text-white hover:bg-accent-hover"><Mail className="size-5" />Prepare audience preview</button>
        </form>
        <aside className="rounded-[var(--sk-card-radius)] border border-line bg-surface-2 p-5 sm:p-7"><Users className="size-7 text-accent" aria-hidden /><h2 className="mt-4 text-xl font-semibold text-ink">What “all contacts” means</h2><p className="mt-3 text-sm leading-6 text-muted">Omnix includes everyone currently marked <strong className="text-ink">subscribed</strong> in the selected Mailchimp audience. It automatically leaves out unsubscribed, cleaned, pending, archived, unresolved, or duplicate records.</p><p className="mt-5 border-t border-line pt-5 text-sm leading-6 text-muted">This protects Judith&apos;s sender reputation and keeps the final decision with the workspace owner.</p></aside>
      </section>}

    <section><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Campaign history</p><h2 className="mt-1 text-2xl font-semibold text-ink">Review and send</h2></div><span className="text-sm text-muted">Page {page}</span></div>
      <div className="mt-5 grid gap-4">{campaigns.length === 0 ? <div className="rounded-[var(--sk-card-radius)] border border-dashed border-line p-8 text-center"><Mail className="mx-auto size-7 text-subtle" /><p className="mt-3 font-medium text-ink">No campaigns yet</p><p className="mt-1 text-sm text-muted">Your first audience preview will appear here.</p></div> : campaigns.map((campaign) => {
        const excluded = Object.values(campaign.excluded).reduce((sum, value) => sum + value, 0);
        return <article key={campaign.id} className="rounded-[var(--sk-card-radius)] border border-line bg-surface p-5 sm:p-6"><div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">{STATE_LABELS[campaign.state]}</span><span className="text-xs text-subtle">{campaign.segment.kind === 'all-subscribers' ? 'All subscribers' : `${campaign.segment.value} leads`}</span></div><h3 className="mt-3 truncate text-lg font-semibold text-ink">{campaign.content.subject}</h3><p className="mt-1 text-sm text-muted">{campaign.content.previewText}</p></div><div className="grid grid-cols-2 gap-3 text-center"><div className="rounded-[var(--sk-control-radius)] bg-nurture-soft px-4 py-3"><strong className="block text-xl text-nurture">{campaign.eligibleCount}</strong><span className="text-xs text-nurture">eligible</span></div><div className="rounded-[var(--sk-control-radius)] bg-surface-2 px-4 py-3"><strong className="block text-xl text-ink">{excluded}</strong><span className="text-xs text-muted">excluded</span></div></div></div>
          <details className="mt-5 rounded-[var(--sk-control-radius)] bg-surface-2 px-4 py-3"><summary className="cursor-pointer text-sm font-semibold text-ink">Preview message</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{campaign.content.plainText}</p></details>
          {campaign.state === 'draft' ? <details className="mt-3 rounded-[var(--sk-control-radius)] border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Edit draft</summary>
            <form action={updateCampaignDraftAction} className="mt-4 grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="version" value={campaign.version} />
              <input type="hidden" name="correlationId" value={randomUUID()} />
              <label className="grid gap-1.5 text-sm font-medium text-ink sm:col-span-2">Audience<select name="segment" defaultValue={campaign.segment.kind === 'all-subscribers' ? 'all-subscribers' : campaign.segment.value} className="min-h-11 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3"><option value="all-subscribers">All subscribed contacts</option><option value="hot">Hot leads</option><option value="warm">Warm leads</option><option value="nurture">Nurture leads</option></select></label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">Internal name<input name="title" required maxLength={160} defaultValue={campaign.content.title} className="min-h-11 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">Subject<input name="subject" required maxLength={150} defaultValue={campaign.content.subject} className="min-h-11 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-ink sm:col-span-2">Preview line<input name="previewText" required maxLength={150} defaultValue={campaign.content.previewText} className="min-h-11 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">From name<input name="fromName" required maxLength={100} defaultValue={campaign.content.fromName} className="min-h-11 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">Replies go to<input type="email" name="replyTo" required defaultValue={campaign.content.replyTo} className="min-h-11 rounded-[var(--sk-control-radius)] border border-control bg-surface px-3" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-ink sm:col-span-2">Message<textarea name="message" required maxLength={100000} rows={7} defaultValue={campaign.content.plainText} className="min-h-40 resize-y rounded-[var(--sk-control-radius)] border border-control bg-surface p-3 leading-6" /></label>
              <button className="min-h-11 rounded-[var(--sk-control-radius)] bg-ink px-4 text-sm font-semibold text-white sm:col-span-2">Save changes and refresh audience</button>
            </form>
          </details> : null}
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            {campaign.state === 'draft' && owner ? <form action={createInMailchimpAction}><input type="hidden" name="campaignId" value={campaign.id} /><button className="inline-flex min-h-11 items-center gap-2 rounded-[var(--sk-control-radius)] bg-accent px-4 text-sm font-semibold text-white"><CheckCircle2 className="size-4" />Create in Mailchimp</button></form> : null}
            {campaign.state === 'created' && owner ? <form action={sendMailchimpCampaignAction} className="flex flex-wrap items-center gap-3"><input type="hidden" name="campaignId" value={campaign.id} /><label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" name="confirmed" value="yes" required className="size-4" />I reviewed the audience and message</label><button className="inline-flex min-h-11 items-center gap-2 rounded-[var(--sk-control-radius)] bg-accent px-4 text-sm font-semibold text-white"><Mail className="size-4" />Send campaign</button></form> : null}
            {campaign.state === 'create_approved' && owner ? <form action={createInMailchimpAction}><input type="hidden" name="campaignId" value={campaign.id} /><button className="inline-flex min-h-11 items-center gap-2 rounded-[var(--sk-control-radius)] bg-accent px-4 text-sm font-semibold text-white"><ShieldCheck className="size-4" />Resume Mailchimp setup safely</button></form> : null}
            {campaign.state === 'send_approved' && owner ? <form action={sendMailchimpCampaignAction}><input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="confirmed" value="yes" /><button className="inline-flex min-h-11 items-center gap-2 rounded-[var(--sk-control-radius)] bg-accent px-4 text-sm font-semibold text-white"><ShieldCheck className="size-4" />Reconcile delivery status</button></form> : null}
            {campaign.state === 'sent' ? <span className="inline-flex items-center gap-2 text-sm font-medium text-nurture"><CheckCircle2 className="size-4" />Delivery accepted by Mailchimp</span> : null}
            {campaign.state === 'failed' ? <span className="inline-flex items-center gap-2 text-sm font-medium text-hot"><XCircle className="size-4" />Review the connection before creating a new campaign</span> : null}
            {!owner && ['draft', 'created'].includes(campaign.state) ? <span className="text-sm text-muted">Waiting for the workspace owner&apos;s approval</span> : null}
          </div></article>;
      })}</div>
      {page > 1 || hasMore ? <nav aria-label="Campaign history pages" className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-5">
        {page > 1 ? <Link href={`/campaigns?page=${page - 1}`} className="inline-flex min-h-11 items-center rounded-[var(--sk-control-radius)] border border-control px-4 text-sm font-semibold text-ink">Previous</Link> : <span />}
        {hasMore ? <Link href={`/campaigns?page=${page + 1}`} className="inline-flex min-h-11 items-center rounded-[var(--sk-control-radius)] bg-ink px-4 text-sm font-semibold text-white">Next</Link> : null}
      </nav> : null}
    </section>
  </div>;
}
