import { describe, expect, it } from 'vitest';
import { HUBS, MOBILE_HUBS, MORE_SECTIONS, activeHub, activeTab, currentLabel, isLinkActive } from './app-navigation';

describe('realtor information architecture', () => {
  it('keeps daily work in exactly five hubs', () => {
    expect(HUBS.map((hub) => hub.label)).toEqual(['Today', 'People', 'Deals', 'Inbox', 'Omnix']);
    expect(MOBILE_HUBS).toHaveLength(4);
  });

  it('keeps every pre-existing destination reachable', () => {
    const reachable = new Set([
      ...HUBS.flatMap((hub) => [hub.href, ...(hub.tabs ?? []).map((tab) => tab.href)]),
      ...MORE_SECTIONS.flatMap((section) => section.links.map((link) => link.href)),
    ]);
    for (const href of ['/', '/contacts', '/activities', '/alerts', '/approvals', '/pipeline', '/insights', '/omnix',
      '/nurture', '/transactions', '/properties', '/campaigns', '/mailers', '/connections', '/data', '/settings', '/workspace']) {
      expect(reachable.has(href), href).toBe(true);
    }
  });

  it('highlights the owning hub for nested routes', () => {
    expect(activeHub('/')?.id).toBe('today');
    expect(activeHub('/contacts/c-1/edit')?.id).toBe('people');
    expect(activeHub('/transactions/scenarios')?.id).toBe('deals');
    expect(activeHub('/approvals')?.id).toBe('inbox');
    expect(activeHub('/settings')).toBeUndefined();
    expect(isLinkActive('/contactsx', { href: '/contacts' })).toBe(false);
  });

  it('selects the most specific tab and names the page', () => {
    const people = activeHub('/contacts/import');
    expect(activeTab('/contacts/import', people)?.label).toBe('Import');
    expect(activeTab('/contacts/c-1', people)?.label).toBe('All people');
    expect(currentLabel('/transactions')).toBe('Transactions');
    expect(currentLabel('/pipeline')).toBe('Deals');
    expect(currentLabel('/mailers')).toBe('Mailers');
  });
});
