/**
 * Information architecture for an independent realtor.
 *
 * Five hubs carry daily work; everything else is reachable one level down
 * without competing for attention. Hubs own the routes that belong to them so
 * the shell can highlight the right hub and show sibling tabs on nested pages.
 * Every pre-existing URL stays valid.
 */

export type HubId = 'today' | 'people' | 'deals' | 'inbox' | 'omnix';
export type IconKey =
  | 'today' | 'people' | 'deals' | 'inbox' | 'omnix'
  | 'pipeline' | 'transactions' | 'properties' | 'approvals' | 'alerts' | 'tasks'
  | 'insights' | 'nurture' | 'campaigns' | 'mailers' | 'connections' | 'data' | 'settings'
  | 'review' | 'import' | 'workspaces' | 'openhouse' | 'sphere';

export interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly icon: IconKey;
  /** Additional path prefixes that belong to this destination. */
  readonly matches?: readonly string[];
}

export interface Hub extends NavLink {
  readonly id: HubId;
  readonly description: string;
  /** Sibling pages shown as tabs while inside the hub. */
  readonly tabs?: readonly NavLink[];
}

export const HUBS: readonly Hub[] = [
  { id: 'today', href: '/', label: 'Today', icon: 'today', description: 'Who to reach and what is due' },
  {
    id: 'people', href: '/contacts', label: 'People', icon: 'people', description: 'Leads, clients and your sphere',
    matches: ['/contacts'],
    tabs: [
      { href: '/contacts', label: 'All people', icon: 'people' },
      { href: '/contacts/incomplete', label: 'Needs review', icon: 'review' },
      { href: '/contacts/import', label: 'Import', icon: 'import' },
    ],
  },
  {
    id: 'deals', href: '/pipeline', label: 'Deals', icon: 'deals', description: 'Pipeline, contracts and listings',
    matches: ['/pipeline', '/transactions', '/properties'],
    tabs: [
      { href: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
      { href: '/transactions', label: 'Transactions', icon: 'transactions' },
      { href: '/properties', label: 'Properties', icon: 'properties' },
    ],
  },
  {
    id: 'inbox', href: '/inbox', label: 'Inbox', icon: 'inbox', description: 'Replies, approvals and tasks waiting on you',
    matches: ['/inbox', '/approvals', '/alerts', '/activities'],
    tabs: [
      { href: '/inbox', label: 'Overview', icon: 'inbox' },
      { href: '/approvals', label: 'Approvals', icon: 'approvals' },
      { href: '/activities', label: 'Tasks', icon: 'tasks' },
      { href: '/alerts', label: 'Alerts', icon: 'alerts' },
    ],
  },
  { id: 'omnix', href: '/omnix', label: 'Omnix', icon: 'omnix', description: 'Ask anything about your business' },
];

export interface NavSection {
  readonly label: string;
  readonly links: readonly NavLink[];
}

/** Secondary destinations, grouped by intent rather than by implementation. */
export const MORE_SECTIONS: readonly NavSection[] = [
  {
    label: 'Grow',
    links: [
      { href: '/sphere', label: 'Referral engine', icon: 'sphere' },
      { href: '/open-house', label: 'Open house', icon: 'openhouse' },
      { href: '/nurture', label: 'Nurture plans', icon: 'nurture' },
      { href: '/campaigns', label: 'Email campaigns', icon: 'campaigns' },
      { href: '/mailers', label: 'Mailers', icon: 'mailers' },
      { href: '/insights', label: 'Insights', icon: 'insights' },
    ],
  },
  {
    label: 'Workspace',
    links: [
      { href: '/connections', label: 'Connections', icon: 'connections' },
      { href: '/data', label: 'Data tools', icon: 'data', matches: ['/data'] },
      { href: '/settings', label: 'Settings', icon: 'settings' },
      { href: '/workspace', label: 'Workspaces', icon: 'workspaces' },
    ],
  },
];

/** Mobile tab bar: four hubs around a central Capture action. */
export const MOBILE_HUBS: readonly HubId[] = ['today', 'people', 'inbox', 'omnix'];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isLinkActive(pathname: string, link: Pick<NavLink, 'href' | 'matches'>): boolean {
  if (link.href === '/') return pathname === '/';
  return [link.href, ...(link.matches ?? [])].some((prefix) => matchesPrefix(pathname, prefix));
}

export function activeHub(pathname: string): Hub | undefined {
  return HUBS.find((hub) => isLinkActive(pathname, hub));
}

/** The most specific tab wins, so /contacts/import highlights Import, not All people. */
export function activeTab(pathname: string, hub: Hub | undefined): NavLink | undefined {
  const tabs = hub?.tabs ?? [];
  return [...tabs]
    .filter((tab) => matchesPrefix(pathname, tab.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

export function currentLabel(pathname: string): string | undefined {
  const hub = activeHub(pathname);
  const tab = activeTab(pathname, hub);
  if (tab && tab.href !== hub?.href) return tab.label;
  if (hub) return hub.label;
  return MORE_SECTIONS.flatMap((section) => section.links).find((link) => isLinkActive(pathname, link))?.label;
}
