import Link from 'next/link';
import { BookOpenCheck, NotebookPen } from 'lucide-react';

export function ConversationActions({ contactId, transactionId, compact = false }: {
  contactId: string; transactionId?: string; compact?: boolean;
}) {
  const base = `/contacts/${encodeURIComponent(contactId)}`;
  const context = transactionId ? `?transactionId=${encodeURIComponent(transactionId)}` : '';
  return <div className={`conversation-actions${compact ? ' is-compact' : ''}`} aria-label="Conversation tools">
    <Link href={`${base}/brief${context}`} className="sk-secondary-button"><BookOpenCheck className="size-4" aria-hidden />Brief me</Link>
    <Link href={`${base}/outcome${context}`} className="sk-secondary-button"><NotebookPen className="size-4" aria-hidden />Capture outcome</Link>
  </div>;
}
