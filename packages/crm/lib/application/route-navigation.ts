export interface ParentRouteNavigation {
  readonly href: string;
  readonly label: string;
  readonly currentLabel: string;
}

function contactRecordId(pathname: string): string | undefined {
  const match = pathname.match(/^\/contacts\/([^/]+)(?:\/edit)?$/);
  return match?.[1];
}

/**
 * Stable application-owned return destinations for nested screens.
 * Browser history is intentionally not used because an external deep link or
 * a restored PWA session may not have a safe in-app history entry.
 */
export function parentRouteNavigation(pathname: string): ParentRouteNavigation | undefined {
  const conversation = pathname.match(/^\/contacts\/([^/]+)\/(brief|outcome)$/);
  if (conversation) return {
    href: `/contacts/${conversation[1]}`, label: 'Contact',
    currentLabel: conversation[2] === 'brief' ? 'Meeting brief' : 'Capture outcome',
  };
  if (pathname === '/contacts/new') {
    return { href: '/contacts', label: 'Contacts', currentLabel: 'Add contact' };
  }
  if (pathname === '/contacts/import') {
    return { href: '/data', label: 'Data tools', currentLabel: 'Import contacts' };
  }
  if (pathname === '/contacts/incomplete') {
    return { href: '/contacts', label: 'Contacts', currentLabel: 'Contact review' };
  }
  if (pathname === '/data/duplicates') {
    return { href: '/data', label: 'Data tools', currentLabel: 'Duplicate review' };
  }
  if (pathname === '/transactions/scenarios') {
    return { href: '/transactions', label: 'Transactions', currentLabel: 'Affordability studio' };
  }

  const id = contactRecordId(pathname);
  if (!id) return undefined;
  if (pathname.endsWith('/edit')) {
    return {
      href: `/contacts/${id}`,
      label: 'Contact',
      currentLabel: 'Edit contact',
    };
  }
  return { href: '/contacts', label: 'Contacts', currentLabel: 'Contact profile' };
}
