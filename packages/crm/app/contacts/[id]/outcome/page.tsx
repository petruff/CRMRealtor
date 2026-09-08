import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaptureOutcome } from '@/components/capture-outcome';
import { getRepository } from '@/lib/data';
import { displayName } from '@/lib/domain/contact';
import type { CaptureOutcomeProposal } from '@/lib/domain/capture-outcome';
import { captureOutcomeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Capture outcome' };

export default async function CaptureOutcomePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ proposalId?: string; transactionId?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await getRepository();
  const contact = await context.repository.get(id);
  if (!contact || contact.archivedAt) notFound();
  if (query.transactionId) {
    const sources = await context.meetingBriefRepository?.loadSources(context.workspaceScope, contact.id, query.transactionId);
    if (!sources?.records.some((record) => record.sourceType === 'transaction' && record.id === query.transactionId && record.contactId === contact.id)) notFound();
  }
  const captures = context.captureOutcomeRepository;
  let initialProposal: CaptureOutcomeProposal | undefined;
  let recent: readonly CaptureOutcomeProposal[] = [];
  let unavailable = !captures;
  if (captures) {
    try {
      if (query.proposalId) initialProposal = await captures.get(context.workspaceScope, query.proposalId);
      else recent = await captures.list(context.workspaceScope, contact.id);
    } catch { unavailable = true; }
  }
  if (query.proposalId && !unavailable && (!initialProposal || initialProposal.contactId !== contact.id)) notFound();
  if (unavailable) return <section className="conversation-workspace"><h1 className="text-2xl font-semibold">Outcome reviews are temporarily unavailable.</h1><p className="mt-3 text-muted">You can still record a note from the contact’s activity history. Retry after the workspace’s review storage is ready.</p><Link className="sk-secondary-button mt-5" href={`/contacts/${encodeURIComponent(contact.id)}`}>Open contact</Link></section>;
  return <><CaptureOutcome key={initialProposal?.id ?? 'new'} contactId={contact.id} contactName={displayName(contact)} isLive={context.isLive} isOwner={context.workspaceScope.role === 'owner'} initialProposal={initialProposal} action={captureOutcomeAction} />{!initialProposal && recent.length > 0 && <section className="conversation-workspace conversation-evidence"><h2 className="py-4 font-semibold">Recent outcome reviews</h2><ul>{recent.slice(0, 10).map((review) => <li key={review.id}><div><strong>{new Date(review.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })}</strong><small>{review.status.replaceAll('-', ' ')} · {review.operations.length} items</small></div><Link href={`/contacts/${encodeURIComponent(contact.id)}/outcome?proposalId=${encodeURIComponent(review.id)}`}>Open review</Link></li>)}</ul></section>}</>;
}
