import Link from 'next/link';
import { CircleHelp, UserCheck, Users } from 'lucide-react';
import { CONTACT_SCOPES, type ContactScope } from '@/lib/application/contact-query';
import { contactViewHref, type ContactViewState } from '@/lib/application/contact-view-state';

interface ContactScopeNavigationProps {
  readonly scope: ContactScope;
  readonly counts: Readonly<Record<ContactScope, number>>;
  readonly viewState: ContactViewState;
}

const PRIMARY_VIEWS = [
  ['leads', 'Leads', Users],
  ['clients', 'Clients', UserCheck],
  ['needs-review', 'Needs review', CircleHelp],
  ['all', 'All contacts', Users],
] as const;

const CLIENT_VIEWS = [
  ['clients', 'All clients'],
  ['active-clients', 'Active clients'],
  ['past-clients', 'Past clients'],
] as const;

export function ContactScopeNavigation({ scope, counts, viewState }: ContactScopeNavigationProps) {
  const clientsSelected = scope === 'clients' || scope === 'active-clients' || scope === 'past-clients';
  return (
    <>
      <nav
        aria-label="Contact views"
        className={`${clientsSelected ? 'mb-3' : 'mb-7'} sk-overflow-rail px-1 pb-2 pt-1`}
      >
        <ul className="flex min-w-max gap-2">
          {PRIMARY_VIEWS.map(([target, label, Icon]) => {
            const selected = target === 'clients' ? clientsSelected : scope === target;
            return (
              <li key={target}>
                <Link
                  href={contactViewHref(viewState, { scope: target })}
                  aria-current={selected ? 'page' : undefined}
                  className={selected
                    ? 'sk-primary-button min-h-11 whitespace-nowrap px-4 ring-2 ring-accent/25 ring-offset-2 ring-offset-canvas'
                    : 'sk-secondary-button min-h-11 whitespace-nowrap px-4'}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-ink">
                    {counts[target]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {clientsSelected ? (
        <nav aria-label="Client views" className="sk-overflow-rail mb-7 px-1 pb-2 pt-1">
          <ul className="flex min-w-max gap-2">
            {CLIENT_VIEWS.map(([target, label]) => (
              <li key={target}>
                <Link
                  href={contactViewHref(viewState, { scope: target })}
                  aria-current={scope === target ? 'page' : undefined}
                  className={scope === target
                    ? 'sk-primary-button min-h-11 whitespace-nowrap px-4'
                    : 'sk-secondary-button min-h-11 whitespace-nowrap px-4'}
                >
                  {label}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-ink">
                    {counts[target]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </>
  );
}

export function emptyContactScopeCounts(): Record<ContactScope, number> {
  return Object.fromEntries(CONTACT_SCOPES.map((scope) => [scope, 0])) as Record<ContactScope, number>;
}
