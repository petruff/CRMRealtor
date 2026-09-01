import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { displayName } from '@/lib/domain/contact';
import {
  contactRecordHref,
  type ContactRecordNavigation,
} from '@/lib/application/contact-navigation';

function DisabledDirection({ direction }: { direction: 'Previous' | 'Next' }) {
  return (
    <span
      aria-disabled="true"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-sm text-subtle opacity-55"
    >
      {direction === 'Previous' ? <ChevronLeft className="size-4" aria-hidden /> : null}
      {direction}
      {direction === 'Next' ? <ChevronRight className="size-4" aria-hidden /> : null}
    </span>
  );
}

export function ContactRecordNavigator({ navigation }: { navigation: ContactRecordNavigation }) {
  const label = navigation.context.archived
    ? 'archived contacts'
    : navigation.context.scope === 'past-clients'
    ? 'past clients'
    : navigation.context.scope === 'active-clients'
      ? 'active clients'
      : navigation.context.scope === 'needs-review'
        ? 'contacts to review'
        : navigation.context.scope === 'clients'
          ? 'clients'
          : navigation.context.scope === 'all'
            ? 'contacts'
            : 'working leads';
  return (
    <nav aria-label="Browse contact records" className="flex flex-wrap items-center justify-end gap-2">
      {navigation.previous ? (
        <Link
          href={contactRecordHref(navigation.previous.id, navigation.context)}
          className="sk-secondary-button px-3"
          aria-label={`Previous contact: ${displayName(navigation.previous)}`}
        >
          <ChevronLeft className="size-4" aria-hidden /> Previous
        </Link>
      ) : <DisabledDirection direction="Previous" />}
      <span className="min-w-24 text-center text-xs tabular-nums text-muted" aria-live="polite">
        {navigation.currentMatches
          ? `${navigation.position} of ${navigation.total} ${label}`
          : `Complete · ${navigation.total} ${label} remaining`}
      </span>
      {navigation.next ? (
        <Link
          href={contactRecordHref(navigation.next.id, navigation.context)}
          className="sk-secondary-button px-3"
          aria-label={`Next contact: ${displayName(navigation.next)}`}
        >
          Next <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : <DisabledDirection direction="Next" />}
    </nav>
  );
}
