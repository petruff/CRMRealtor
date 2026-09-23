import type { Metadata } from 'next';
import { InboxHub } from '@/components/inbox-hub';
import { loadInbox } from './load-inbox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Inbox',
  description: 'Replies, approvals, tasks and deal alerts waiting on your decision.',
};

export default async function InboxPage() {
  const inbox = await loadInbox();
  return <InboxHub projection={inbox.projection} asOf={inbox.asOf} timeZone={inbox.timeZone} />;
}
