import Link from 'next/link';
import { BookOpenCheck, ArrowUpRight } from 'lucide-react';
import { ConversationActions } from '@/components/conversation-actions';
import { displayName, initials, type Contact } from '@/lib/domain/contact';
import { Avatar } from '@/components/ui';

export function TodayConversations({ contacts }: { contacts: readonly Contact[] }) {
  if (!contacts.length) return null;
  return <section className="today-conversations" aria-labelledby="today-conversations-title">
    <div className="conversation-section-heading">
      <div><span className="conversation-icon"><BookOpenCheck className="size-5" aria-hidden /></span><h2 id="today-conversations-title">Make every conversation count.</h2><p>Get the context before you connect. Capture the next steps while they’re fresh.</p></div>
      <Link className="conversation-text-link" href="/contacts">All contacts <ArrowUpRight className="size-4" aria-hidden /></Link>
    </div>
    <ul className="conversation-people">{contacts.slice(0, 3).map((contact) => <li key={contact.id}>
      <Link className="conversation-person" href={`/contacts/${encodeURIComponent(contact.id)}`}><Avatar initials={initials(contact)} leadType={contact.leadType} relationship={contact.relationship} /><span><strong>{displayName(contact)}</strong><small>{contact.nextTouchAt ? `Follow-up ${contact.nextTouchAt.slice(0, 10)}` : 'Prepare your next conversation'}</small></span></Link>
      <ConversationActions contactId={contact.id} compact />
    </li>)}</ul>
  </section>;
}
