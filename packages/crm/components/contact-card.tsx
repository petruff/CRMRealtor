import Link from 'next/link';
import { Phone, MessageSquare, Mail } from 'lucide-react';
import { INTENT_LABEL, PIPELINE_LABEL, displayName, initials } from '@/lib/domain/contact';
import type { TriageEntry } from '@/lib/domain/triage';
import { Avatar, IconAction, LeadBadge } from './ui';

/**
 * Quick actions are plain `tel:` / `sms:` / `mailto:` links.
 *
 * That is deliberate: it delivers her Gmail wish (a) — "click a contact, it opens
 * a new email to them" — in phase 1 with no OAuth, and on a phone it opens the
 * actual dialer and Messages app, which is what she wants at an open house.
 * Logging and in-app sending arrive in phase 2.
 */
export function ContactCard({
  entry,
  compact = false,
}: {
  entry: TriageEntry;
  compact?: boolean;
}) {
  const { contact, reason, daysOverdue } = entry;
  const name = displayName(contact);

  // Only the genuinely late get the emphasis; otherwise the signal stops meaning anything.
  const urgent = daysOverdue > 0 || !contact.lastContactedAt;

  const meta = [
    INTENT_LABEL[contact.intent],
    contact.pipelineStage === 'new' ? null : PIPELINE_LABEL[contact.pipelineStage],
    contact.city,
  ].filter(Boolean);

  return (
    <article className={`group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 bg-surface p-4 ${compact ? '' : 'sm:flex sm:p-5'}`}>
      <Avatar initials={initials(contact)} leadType={contact.leadType} relationship={contact.relationship} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/contacts/${contact.id}`}
            className="truncate font-medium text-ink underline-offset-2 hover:underline"
          >
            {name}
          </Link>
          <LeadBadge leadType={contact.leadType} relationship={contact.relationship} />
        </div>

        <p className={`mt-0.5 text-[13px] ${urgent ? 'font-medium text-hot' : 'text-muted'}`}>
          {reason}
        </p>

        {meta.length > 0 && (
          <p className="mt-1 truncate text-xs text-subtle">{meta.join(' · ')}</p>
        )}
      </div>

      <div className={`col-start-2 flex shrink-0 items-center gap-1.5 ${compact ? '' : 'sm:ml-auto'}`}>
        {contact.phone && (
          <>
          <IconAction href={`tel:${contact.phone}`} label={`Call ${name}`} callContact={{ id: contact.id, name }}>
            <Phone className="size-4" />
          </IconAction>
          <IconAction href={`sms:${contact.phone}`} label={`Text ${name}`}>
            <MessageSquare className="size-4" />
          </IconAction>
          </>
        )}
        {contact.email && (
          <IconAction href={`mailto:${contact.email}`} label={`Email ${name}`}>
            <Mail className="size-4" />
          </IconAction>
        )}
      </div>
    </article>
  );
}
