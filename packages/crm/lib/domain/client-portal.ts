/**
 * Client portal: a private, read-only view a realtor shares with her buyer or
 * seller. The link carries a 256-bit random token; only its SHA-256 hash is
 * stored. The snapshot is allowlisted — property, status and key dates — and
 * never includes contact details, commission, notes or document references.
 */

export const PORTAL_EXPIRY_CHOICES = [30, 60, 90] as const;
export type PortalExpiryDays = (typeof PORTAL_EXPIRY_CHOICES)[number];

export interface ClientPortalLink {
  readonly id: string;
  readonly transactionId: string;
  readonly audienceLabel: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly lastViewedAt?: string;
  readonly viewCount: number;
}

export interface PortalMilestone {
  readonly kind: string;
  readonly label: string;
  readonly dueAt: string;
  readonly state: 'open' | 'completed' | 'waived';
  readonly timezone: string;
}

export interface ClientPortalSnapshot {
  readonly audience: string;
  readonly agentName?: string;
  readonly propertyAddress: string;
  readonly status: 'pending' | 'under-contract' | 'closed';
  readonly side: 'buyer' | 'seller' | 'dual' | 'referral';
  readonly expectedCloseDate?: string;
  readonly closedAt?: string;
  readonly expiresAt: string;
  readonly milestones: readonly PortalMilestone[];
}

export class ClientPortalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientPortalError';
  }
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

export function isPortalToken(value: string): boolean {
  return TOKEN.test(value);
}

export function validateAudienceLabel(value: unknown): string {
  const label = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  if (label.length < 1 || label.length > 80 || CONTROL.test(label)) throw new ClientPortalError('Add who this link is for (up to 80 characters).');
  return label;
}

export function portalExpiry(days: unknown, now: Date): string {
  const parsed = Number(days);
  if (!(PORTAL_EXPIRY_CHOICES as readonly number[]).includes(parsed)) throw new ClientPortalError('Choose how long the link stays open.');
  return new Date(now.getTime() + parsed * 86_400_000).toISOString();
}

export function linkIsActive(link: Pick<ClientPortalLink, 'revokedAt' | 'expiresAt'>, now: Date): boolean {
  return !link.revokedAt && Date.parse(link.expiresAt) > now.getTime();
}

/** Parses the untrusted RPC payload into the allowlisted snapshot shape. */
export function parsePortalSnapshot(value: unknown): ClientPortalSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const text = (key: string) => (typeof row[key] === 'string' && row[key] ? String(row[key]) : undefined);
  const status = text('status');
  const side = text('side');
  const propertyAddress = text('propertyAddress');
  const expiresAt = text('expiresAt');
  if (!propertyAddress || !expiresAt || !status || !['pending', 'under-contract', 'closed'].includes(status)) return undefined;
  const milestones = Array.isArray(row.milestones) ? row.milestones.flatMap((entry): PortalMilestone[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const state = String(item.state ?? '');
    if (!['open', 'completed', 'waived'].includes(state) || typeof item.label !== 'string' || typeof item.dueAt !== 'string') return [];
    return [{ kind: String(item.kind ?? 'custom'), label: item.label, dueAt: item.dueAt, state: state as PortalMilestone['state'], timezone: String(item.timezone ?? 'America/New_York') }];
  }) : [];
  return {
    audience: text('audience') ?? 'you',
    ...(text('agentName') ? { agentName: text('agentName') } : {}),
    propertyAddress,
    status: status as ClientPortalSnapshot['status'],
    side: (['buyer', 'seller', 'dual', 'referral'].includes(side ?? '') ? side : 'buyer') as ClientPortalSnapshot['side'],
    ...(text('expectedCloseDate') ? { expectedCloseDate: text('expectedCloseDate') } : {}),
    ...(text('closedAt') ? { closedAt: text('closedAt') } : {}),
    expiresAt,
    milestones,
  };
}

export interface PortalStep {
  readonly label: string;
  readonly date?: string;
  readonly timezone?: string;
  readonly state: 'done' | 'current' | 'upcoming' | 'skipped';
}

export interface PortalView {
  readonly headline: string;
  readonly subline: string;
  readonly daysToClose?: number;
  readonly steps: readonly PortalStep[];
  readonly next?: PortalStep;
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

/** Turns the snapshot into the calm, client-facing story of the deal. */
export function portalView(snapshot: ClientPortalSnapshot, now: Date, timeZone = 'America/New_York'): PortalView {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const selling = snapshot.side === 'seller';
  const steps: PortalStep[] = snapshot.milestones
    .filter((item) => item.kind !== 'closing')
    .map((item) => ({
      label: item.label,
      date: item.dueAt,
      timezone: item.timezone,
      state: item.state === 'completed' ? 'done' : item.state === 'waived' ? 'skipped' : 'upcoming',
    }));
  const closingMilestone = snapshot.milestones.find((item) => item.kind === 'closing');
  const closingDate = snapshot.closedAt ?? snapshot.expectedCloseDate;
  steps.push({
    label: 'Closing day',
    ...(closingMilestone ? { date: closingMilestone.dueAt, timezone: closingMilestone.timezone } : closingDate ? { date: `${closingDate}T12:00:00.000Z`, timezone: 'UTC' } : {}),
    state: snapshot.status === 'closed' ? 'done' : 'upcoming',
  });
  const firstOpen = steps.findIndex((step) => step.state === 'upcoming');
  const ordered = steps.map((step, index) => (index === firstOpen ? { ...step, state: 'current' as const } : step));
  const daysToClose = snapshot.status !== 'closed' && snapshot.expectedCloseDate ? daysBetween(today, snapshot.expectedCloseDate) : undefined;
  const headline = snapshot.status === 'closed' ? (selling ? 'Sold — congratulations!' : 'Welcome home — congratulations!')
    : snapshot.status === 'under-contract' ? 'Under contract'
      : selling ? 'Getting your home ready to sell' : 'Finding your next home';
  const subline = snapshot.status === 'closed' ? 'Thank you for trusting us with this move.'
    : daysToClose === 0 ? 'Closing is today'
      : daysToClose !== undefined && daysToClose > 0 && snapshot.expectedCloseDate ? `Closing ${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${snapshot.expectedCloseDate}T12:00:00Z`))}`
      : 'Here is where everything stands.';
  const next = ordered.find((step) => step.state === 'current');
  return { headline, subline, ...(daysToClose !== undefined && daysToClose > 0 ? { daysToClose } : {}), steps: ordered, ...(next ? { next } : {}) };
}
