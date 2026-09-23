import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { MeetingBrief } from '@/components/meeting-brief';
import { getRepository } from '@/lib/data';
import { buildMeetingBrief, getMeetingBrief, refreshMeetingBrief } from '@/lib/application/meeting-brief-service';
import { MeetingBriefError, type MeetingBriefEnvelope } from '@/lib/domain/meeting-brief';
import { narrateMeetingBriefAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Meeting brief' };

export default async function MeetingBriefPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ snapshotId?: string; transactionId?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await getRepository();
  const contact = await context.repository.get(id);
  if (!contact || contact.archivedAt) notFound();
  let brief: MeetingBriefEnvelope | undefined;
  try {
    if (context.meetingBriefRepository) {
      const dependencies = { ...context, meetingBriefRepository: context.meetingBriefRepository };
      brief = query.snapshotId ? await getMeetingBrief(dependencies, query.snapshotId)
        : await buildMeetingBrief(dependencies, { contactId: contact.id, transactionId: query.transactionId, trigger: query.transactionId ? 'transaction' : 'contact' });
    }
  } catch (error) {
    if (error instanceof MeetingBriefError && error.code === 'not-found') notFound();
  }
  if (brief && brief.snapshot.subjectContactId !== contact.id) notFound();
  if (brief && !query.snapshotId) redirect(`/contacts/${encodeURIComponent(contact.id)}/brief?snapshotId=${encodeURIComponent(brief.snapshot.id)}`);

  async function refreshAction(form: FormData) {
    'use server';
    const current = await getRepository();
    let href = `/contacts/${encodeURIComponent(id)}/brief?error=refresh`;
    try {
      if (!current.meetingBriefRepository) throw new Error('unavailable');
      const dependencies = { ...current, meetingBriefRepository: current.meetingBriefRepository };
      const existing = await getMeetingBrief(dependencies, String(form.get('snapshotId')));
      const authorizedContact = await current.repository.get(id);
      if (!authorizedContact || existing.snapshot.subjectContactId !== authorizedContact.id) throw new Error('unavailable');
      const next = await refreshMeetingBrief(dependencies, existing.snapshot.id, Number(form.get('version')));
      href = `/contacts/${encodeURIComponent(id)}/brief?snapshotId=${encodeURIComponent(next.snapshot.id)}`;
    } catch { /* A bounded route error retains ordinary contact access. */ }
    redirect(href);
  }
  return <>{query.error && <p className="capture-feedback is-error" role="alert">The brief could not be refreshed. Open a new brief from the contact record and try again.</p>}{brief ? <MeetingBrief brief={brief} refreshAction={refreshAction} highlightAction={narrateMeetingBriefAction} /> : <section className="conversation-workspace"><h1 className="text-2xl font-semibold">Meeting brief is temporarily unavailable.</h1><p className="mt-3 text-muted">Your contact record is still available. Retry after the workspace’s briefing storage is ready.</p><Link href={`/contacts/${encodeURIComponent(contact.id)}`} className="sk-secondary-button mt-5">Open contact</Link></section>}</>;
}
