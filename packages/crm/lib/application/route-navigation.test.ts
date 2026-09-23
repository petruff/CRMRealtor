import { describe, expect, it } from 'vitest';
import { parentRouteNavigation } from './route-navigation';

describe('parentRouteNavigation', () => {
  it.each([
    ['/contacts/new', '/contacts', 'Add contact'],
    ['/contacts/import', '/data', 'Import contacts'],
    ['/contacts/incomplete', '/contacts', 'Contact review'],
    ['/data/duplicates', '/data', 'Duplicate review'],
    ['/transactions/scenarios', '/transactions', 'Affordability studio'],
    ['/contacts/c-1/brief', '/contacts/c-1', 'Meeting brief'],
    ['/contacts/c-1/outcome', '/contacts/c-1', 'Capture outcome'],
  ])('maps %s to its deterministic parent', (pathname, href, currentLabel) => {
    expect(parentRouteNavigation(pathname)).toMatchObject({ href, currentLabel });
  });

  it('maps a contact profile to Contacts', () => {
    expect(parentRouteNavigation('/contacts/contact-1')).toEqual({
      href: '/contacts',
      label: 'Contacts',
      currentLabel: 'Contact profile',
    });
  });

  it('maps a contact editor to its contact record', () => {
    expect(parentRouteNavigation('/contacts/contact%201/edit')).toEqual({
      href: '/contacts/contact%201',
      label: 'Contact',
      currentLabel: 'Edit contact',
    });
  });

  it('does not invent parent or sequential navigation for a command center', () => {
    expect(parentRouteNavigation('/omnix')).toBeUndefined();
    expect(parentRouteNavigation('/pipeline')).toBeUndefined();
  });
});
