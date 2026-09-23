import type { Metadata } from 'next';
import Link from 'next/link';
import { FairHousingNotice } from '@/components/fair-housing-notice';
import { ArrowUpRight, Check, ChevronRight, Clock3, Gauge, MessageCircleReply, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hashOmnixProposalPayload, listOmnixApprovalInboxCommand } from '@/lib/application/omnix-proposal-commands';
import { getRepository } from '@/lib/data';
import type { OmnixActionProposal, OmnixProposalVersion } from '@/lib/domain/omnix-operational-brain';
import { acknowledgeInboundResponseAction, decideOmnixProposalAction, retryOmnixProposalAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Approval Inbox' };

const PRIORITY_COPY = {
  p0: ['Act now', 'text-hot bg-hot-soft border-hot-border'],
  p1: ['High priority', 'text-hot bg-hot-soft border-hot-border'],
  p2: ['Important', 'text-warm bg-warm-soft border-warm-border'],
  p3: ['Planned', 'text-accent bg-accent-soft border-line-strong'],
  p4: ['Low pressure', 'text-muted bg-surface-2 border-line'],
} as const;

function when(value: string): string {
  if (!Number.isFinite(Date.parse(value))) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

const PAYLOAD_LABELS: Readonly<Record<string, string>> = {
  title: 'Title', subject: 'Email subject', body: 'Message / note', description: 'Description', message: 'Campaign message',
  dueAt: 'Proposed due date', recipient: 'Recipient', sender: 'Sender', to: 'Recipient', from: 'Sender',
  contactId: 'Contact record', transactionId: 'Transaction record', taskId: 'Task record',
  startAt: 'Proposed start', endAt: 'Proposed end', timeZone: 'Time zone',
  fromStage: 'Current stage', toStage: 'Proposed stage', stage: 'Proposed stage',
  segment: 'Proposed audience', cadenceDays: 'Days between touches', maximumSteps: 'Maximum touches',
  action: 'Plan change', snoozedUntil: 'Proposed resume date', stopReason: 'Stop reason',
  targetResolutionRequired: 'Sender and recipient still need review', audienceReviewRequired: 'Audience still needs review',
  captureExactTarget: 'Bound to the reviewed target', expectedVersion: 'Required current version',
  expectedUpdatedAt: 'Required record update', contactPointVersion: 'Required recipient update',
  connectionVersion: 'Required connection update', connectionId: 'Connection record', contactPointId: 'Contact email record',
};

function ProposalPayload({ proposal, version }: { proposal: OmnixActionProposal; version: OmnixProposalVersion }) {
  const payload = version.payload;
  const unresolved = payload.targetResolutionRequired === true || payload.audienceReviewRequired === true;
  return (
    <section aria-label="Exact proposed action" className="mt-5 rounded-[var(--sk-control-radius)] border border-line bg-surface-2 p-4">
      <h3 className="font-medium text-ink">Review the exact {proposal.kind.replaceAll('-', ' ')}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">Saved version {version.version}. Proposed text and dates require your review; they are not completed actions.</p>
      <dl className="mt-4 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        {Object.entries(payload).map(([key, value]) => (
          <div key={key} className={['body', 'description', 'message'].includes(key) || typeof value === 'object' ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
            <dt className="text-xs font-medium text-muted">{PAYLOAD_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-ink [overflow-wrap:anywhere]">{value === null ? 'Not set' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</dd>
          </div>
        ))}
      </dl>
      <FairHousingNotice texts={['subject', 'previewText', 'body', 'message', 'description'].map((key) => payload[key]).filter((value): value is string => typeof value === 'string')} />
      {proposal.contactId ? <Link href={`/contacts/${encodeURIComponent(proposal.contactId)}`} className="mt-3 inline-flex min-h-11 items-center text-sm text-accent">Open target contact <ArrowUpRight className="ml-1 size-4" aria-hidden /></Link> : null}
      {unresolved ? (
        <div className="mt-4 border-t border-line pt-3 text-sm text-muted">
          <p>{payload.audienceReviewRequired === true ? 'Choose the campaign audience and sender in campaign review before approval.' : 'Choose the exact recipient and sender in capture review before approval.'} This draft cannot be approved here until its target is resolved.</p>
          <Link href={proposal.kind === 'google-email-draft' && proposal.contactId ? `/contacts/${encodeURIComponent(proposal.contactId)}/outcome` : '/campaigns'} className="sk-secondary-button mt-3">Review target and draft <ArrowUpRight className="size-4" aria-hidden /></Link>
        </div>
      ) : null}
    </section>
  );
}

function factors(proposal: OmnixActionProposal): string[] {
  const value = proposal.priorityFactors;
  return [
    `${value.leadTemperature === 'unknown' ? 'Unclassified' : value.leadTemperature} relationship`,
    value.daysOverdue ? `${value.daysOverdue} day${value.daysOverdue === 1 ? '' : 's'} overdue` : 'On schedule',
    value.awaitingReply ? 'Reply waiting' : null,
    value.potentialValueCents ? 'Potential value recorded' : null,
  ].filter((item): item is string => Boolean(item));
}

function ProposalCard({ proposal, version, owner }: {
  proposal: OmnixActionProposal; version?: OmnixProposalVersion; owner: boolean;
}) {
  const [priorityLabel, priorityTone] = PRIORITY_COPY[proposal.priority];
  const intact = Boolean(version && version.proposalId === proposal.id && version.version === proposal.currentVersion
    && hashOmnixProposalPayload(version.payload) === version.contentHash);
  const unexpired = Date.parse(proposal.expiresAt) > Date.now();
  const unresolved = version?.payload.targetResolutionRequired === true || version?.payload.audienceReviewRequired === true;
  const reviewable = intact && unexpired && !unresolved;
  const canDecide = reviewable && proposal.state === 'pending' && (proposal.approvalMode !== 'owner' || owner);
  const canRetry = reviewable && proposal.state === 'failed' && (proposal.approvalMode !== 'owner' || owner);
  return (
    <article id={`proposal-${proposal.id}`} className="group relative scroll-mt-24 overflow-hidden rounded-[calc(var(--sk-card-radius)+0.2rem)] border border-line bg-surface p-5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--sk-shadow-md)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${priorityTone}`}>{priorityLabel}</span>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">{proposal.origin === 'gemini' ? 'AI-assisted' : 'CRM rule'}</span>
        </div>
        <span className="text-xs tabular-nums text-subtle">Score {proposal.priorityScore.toLocaleString('en-US')}</span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight text-ink sm:text-[1.8rem]">{proposal.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{proposal.rationale}</p>
          {version && intact ? <ProposalPayload proposal={proposal} version={version} /> : <p role="status" className="mt-4 text-sm text-hot">The saved action is unavailable or changed. Approval is disabled; open a fresh review.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {factors(proposal).map((factor) => <span key={factor} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted">{factor}</span>)}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-subtle">
            {proposal.dueAt ? <span>Proposed due {when(proposal.dueAt)}</span> : null}
            <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden />Review expires {when(proposal.expiresAt)}</span>
            <span>Version {proposal.currentVersion}</span>
            <span>{proposal.approvalMode === 'owner' ? 'Owner approval' : 'Member approval'}</span>
          </div>
        </div>

        {canDecide ? (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <form action={decideOmnixProposalAction}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="version" value={proposal.currentVersion} />
              <button name="decision" value="reject" className="sk-secondary-button w-full justify-center"><X className="size-4" aria-hidden />Not now</button>
            </form>
            <form action={decideOmnixProposalAction}>
              <input type="hidden" name="proposalId" value={proposal.id} />
              <input type="hidden" name="version" value={proposal.currentVersion} />
              <button name="decision" value="approve" className="sk-button-primary w-full justify-center"><Check className="size-4" aria-hidden />Approve</button>
            </form>
          </div>
        ) : canRetry ? (
          <form action={retryOmnixProposalAction}>
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="hidden" name="version" value={proposal.currentVersion} />
            <button className="sk-button-primary w-full justify-center"><Clock3 className="size-4" aria-hidden />Try again</button>
          </form>
        ) : (
          <div className="rounded-[var(--sk-control-radius)] border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
            {!intact ? 'Saved action unavailable.' : unresolved ? 'Target review required.' : !unexpired && ['pending', 'failed'].includes(proposal.state) ? 'This review expired. Create a fresh proposal.' : proposal.state === 'pending'
              ? 'Waiting for the workspace owner.'
              : proposal.state === 'executed'
                ? `Execution recorded${proposal.executionReference ? `: ${proposal.executionReference}` : '.'}`
                : `Status: ${proposal.state.replace('-', ' ')}`}
          </div>
        )}
      </div>

      {version && intact ? (
        <details className="mt-5 border-t border-line pt-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-ink">
            <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-accent" aria-hidden />Why Omnix recommended this</span>
            <ChevronRight className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <p className="mt-3 break-all text-xs text-subtle">Saved action fingerprint: {version.contentHash}</p>
          <div className="grid gap-2 pb-1 pt-2 sm:grid-cols-2">
            {version.citations.map((citation) => (
              <Link key={`${citation.entityType}:${citation.recordId}:${citation.factKeys.join(',')}`} href={citation.href} className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--sk-control-radius)] bg-surface-2 p-3 text-sm text-muted hover:text-accent">
                <span className="min-w-0"><strong className="block truncate font-medium text-ink">{citation.entityType.replace('-', ' ')}</strong><span className="line-clamp-2 text-xs">{citation.factKeys.join(', ')}</span></span>
                <ArrowUpRight className="size-4 shrink-0" aria-hidden />
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export default async function ApprovalInboxPage({ searchParams }: { searchParams?: Promise<{ proposalId?: string | string[] }> }) {
  const context = await getRepository();
  const requested = (await searchParams)?.proposalId;
  const requestedId = typeof requested === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(requested) ? requested : undefined;
  const [inbox, replies, selected] = await Promise.all([
    listOmnixApprovalInboxCommand(context.omnixProposalRepository, context.workspaceScope, { limit: 50 }),
    context.operationalSignalRepository.listInbound(context.workspaceScope, { unacknowledgedOnly: true, limit: 50 }),
    requestedId ? context.omnixProposalRepository.get(context.workspaceScope, requestedId).catch(() => undefined) : undefined,
  ]);
  const proposals = selected ? [selected, ...inbox.filter((proposal) => proposal.id !== selected.id)] : inbox;
  const versions = await Promise.all(proposals.map((proposal) => context.omnixProposalRepository.getVersion(context.workspaceScope, proposal.id, proposal.currentVersion).catch(() => undefined)));
  const highPriority = proposals.filter((proposal) => proposal.priority === 'p0' || proposal.priority === 'p1').length;
  const aiAssisted = proposals.filter((proposal) => proposal.origin === 'gemini').length;
  const summary: readonly [number, string, LucideIcon][] = [
    [proposals.length + replies.length, 'Waiting for review', Sparkles],
    [highPriority, 'High priority', Gauge],
    [aiAssisted, 'AI-assisted', ShieldCheck],
  ];

  return (
    <div>
      <header className="mb-8 md:mb-10">
        <div className="flex flex-wrap items-center gap-2"><p className="eyebrow">Omnix Approval Inbox</p><span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{context.isLive ? 'Live CRM' : 'Sample data'}</span></div>
        <h1 className="mt-2 max-w-4xl font-display text-[2.5rem] leading-[1.02] text-ink sm:text-5xl md:text-[3.6rem]">Decide what moves <span className="text-muted">next.</span></h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">Omnix organizes recommendations by urgency and business context. Review the reason and evidence before anything changes.</p>
      </header>
      {requested !== undefined && !selected ? <p role="status" className="mb-6 rounded-[var(--sk-control-radius)] border border-line bg-surface-2 p-4 text-sm text-muted">This proposal is unavailable in the current workspace. Your current review queue is shown below.</p> : null}

      <section aria-label="Approval summary" className="mb-6 grid overflow-hidden rounded-[var(--sk-card-radius)] border border-line bg-line sm:grid-cols-3">
        {summary.map(([value, label, Icon]) => (
          <article key={String(label)} className="flex min-h-28 items-end justify-between gap-4 bg-surface p-5">
            <div><strong className="font-display text-4xl font-medium text-ink">{String(value)}</strong><p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-muted">{String(label)}</p></div>
            <Icon className="size-5 text-accent" aria-hidden />
          </article>
        ))}
      </section>

      {replies.length ? (
        <section aria-labelledby="reply-review-title" className="mb-7">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div><p className="eyebrow">Incoming replies</p><h2 id="reply-review-title" className="mt-1 font-display text-2xl text-ink">Conversations that moved.</h2></div>
            <span className="text-xs text-muted">Oldest first</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {replies.map((reply) => (
              <article key={reply.id} className="rounded-[var(--sk-card-radius)] border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><MessageCircleReply className="size-5" aria-hidden /></span>
                  <span className="text-xs tabular-nums text-subtle">{when(reply.receivedAt)}</span>
                </div>
                <h3 className="mt-4 font-display text-2xl text-ink">{reply.contactName}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {reply.summary ?? (reply.intelligenceState === 'pending'
                    ? 'A reply arrived. Open the contact to review it; AI reply insights are not enabled for this message.'
                    : 'A reply arrived, but Omnix could not safely classify its meaning.')}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[reply.intent, reply.sentiment, reply.urgency].filter(Boolean).map((value) => (
                    <span key={value} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs capitalize text-muted">{value}</span>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                  <Link href={`/contacts/${reply.contactId}`} className="sk-secondary-button">Open contact <ArrowUpRight className="size-4" aria-hidden /></Link>
                  <form action={acknowledgeInboundResponseAction}>
                    <input type="hidden" name="signalId" value={reply.id} />
                    <button className="sk-button-primary"><Check className="size-4" aria-hidden />Mark reviewed</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {proposals.length ? (
        <section aria-label="Prioritized proposals" className="grid gap-4">
          {proposals.map((proposal, index) => <ProposalCard key={proposal.id} proposal={proposal} version={versions[index]} owner={context.workspaceScope.role === 'owner'} />)}
        </section>
      ) : replies.length ? null : (
        <section className="rounded-[var(--sk-card-radius)] border border-line bg-surface px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent"><Check className="size-5" aria-hidden /></span>
          <h2 className="mt-4 font-display text-2xl text-ink">You are all caught up.</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">The daily scheduler will place new, evidence-backed recommendations here. Omnix never approves them for you.</p>
          <Link href="/omnix" className="sk-secondary-button mt-5 inline-flex">Open Omnix AI <ArrowUpRight className="size-4" aria-hidden /></Link>
        </section>
      )}
    </div>
  );
}
