/**
 * Contact domain model.
 *
 * Modelling decision that matters: `leadType` (temperature) and `relationship`
 * (where someone sits in the business) are ORTHOGONAL axes. A past client can be
 * Hot. Simple CRMs collapse these into one field, which is precisely how agents
 * lose track of their sphere — the people who actually generate referrals.
 *
 * Field set follows established real estate practice: buyer/seller intent,
 * pre-approval status, and referral attribution are what an agent actually
 * works from.
 */

/** Follow-up urgency. Client's own taxonomy — do not rename. */
export type LeadType = 'hot' | 'warm' | 'nurture';

/** Whether priority has been deliberately classified. Independent of temperature. */
export type QualificationStatus = 'qualified' | 'needs-qualification';

/** Where this person sits in the business. Independent of temperature. */
export type Relationship = 'lead' | 'active-client' | 'past-client' | 'sphere';

/** What they're trying to do. */
export type Intent = 'buyer' | 'seller' | 'both' | 'investor' | 'renter' | 'unknown';

/** Acquisition channel — matches the client's actual sources (§1 of her answers). */
export type LeadSource =
  | 'cold-call'
  | 'open-house'
  | 'referral'
  | 'social-media'
  | 'website'
  | 'mailer'
  | 'other';

/** Deal progression. Client confirmed she wants under-contract / closed stages. */
export type PipelineStage =
  | 'new'
  | 'contacted'
  | 'appointment-set'
  | 'active'
  | 'under-contract'
  | 'closed'
  | 'lost';

export interface Note {
  id: string;
  contactId: string;
  body: string;
  /**
   * ISO timestamp of creation. Identity (id, contact) and createdAt never change;
   * body edits keep the note in place and preserve the replaced text as a revision.
   */
  createdAt: string;
  /** Optimistic-concurrency version: 1 until the first edit, then incremented per edit. */
  revision?: number;
  /** ISO timestamp of the latest edit. Absent for notes that were never edited. */
  updatedAt?: string;
  editedByMembershipId?: string;
  archivedAt?: string;
  archivedByMembershipId?: string;
  archiveReason?: string;
}

export interface NoteEditInput {
  readonly noteId: string;
  readonly body: string;
  /** Revision the editor started from; a different current revision is a conflict. */
  readonly expectedRevision: number;
  /** Idempotency key: a replayed submission never creates a second revision. */
  readonly correlationId: string;
  readonly occurredAt?: string;
}

export type NoteEditErrorCode = 'conflict' | 'read-only' | 'not-found';

/** Typed persistence outcome so callers can explain conflicts without parsing driver messages. */
export class NoteEditError extends Error {
  readonly code: NoteEditErrorCode;

  constructor(code: NoteEditErrorCode, message: string) {
    super(message);
    this.name = 'NoteEditError';
    this.code = code;
  }
}

export interface BuyerCriteria {
  priceMin?: number;
  priceMax?: number;
  areas?: string[];
  beds?: number;
  baths?: number;
  /** Free text: "spring 2027", "ASAP", "watching the market". */
  timeline?: string;
  preApproved?: boolean;
  lender?: string;
  mortgageType?: 'conventional' | 'fha' | 'va' | 'cash' | 'unknown';
  desiredPropertyType?: string;
  currentTenure?: 'owns' | 'rents' | 'unknown';
}

export interface SellerCriteria {
  propertyAddress?: string;
  targetPrice?: number;
  timeline?: string;
  /** Why they're moving — the single most useful thing to remember. */
  motivation?: string;
  hasPropertyToSell?: 'yes' | 'no' | 'maybe' | 'unknown';
  propertyType?: string;
  basement?: string;
  parking?: string;
  condition?: string;
  listingStatus?: string;
  bedrooms?: number;
  bathrooms?: number;
}

export interface Contact {
  id: string;

  firstName: string;
  lastName: string;
  /** What she actually calls them. Overrides firstName in the UI when present. */
  preferredName?: string;

  phone?: string;
  secondaryPhone?: string;
  email?: string;

  mailingAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;

  /** ISO date (YYYY-MM-DD). Year may be inaccurate; only month/day are used. */
  birthdate?: string;
  /** Closing date. Drives the "homeaversary" touchpoint. */
  homePurchaseDate?: string;

  leadType: LeadType;
  /** User-facing `Needs review` is stored separately from Hot/Warm/Nurture. */
  qualificationStatus?: QualificationStatus;
  relationship: Relationship;
  intent: Intent;
  source: LeadSource;
  pipelineStage: PipelineStage;

  buyer?: BuyerCriteria;
  seller?: SellerCriteria;

  /** Contact id of the referrer. Referral attribution compounds over a career. */
  referredById?: string;

  /** ISO timestamp of the last real conversation. Undefined = never contacted. */
  lastContactedAt?: string;
  /** ISO date the next touch is due. Manually overridable at all times. */
  nextTouchAt?: string;
  /** True when she has hand-set nextTouchAt; the engine then leaves it alone. */
  touchDateOverridden?: boolean;

  tags: string[];

  /** ISO timestamp the CRM record was created. */
  createdAt: string;
  /** Canonical persistence version used for optimistic pipeline moves. */
  updatedAt?: string;

  /** Archive replaces destructive contact deletion and preserves the same ID/history. */
  archivedAt?: string;
  archivedByMembershipId?: string;
  archiveReason?: string;

  /** Mirrors Mailchimp subscription state so we never email an opt-out. */
  emailSubscribed?: boolean;
}

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  hot: 'Hot',
  warm: 'Warm',
  nurture: 'Nurture',
};

export const QUALIFICATION_STATUS_LABEL: Record<QualificationStatus, string> = {
  qualified: 'Qualified',
  'needs-qualification': 'Needs review',
};

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  lead: 'Lead',
  'active-client': 'Active client',
  'past-client': 'Past client',
  sphere: 'Sphere',
};

export const INTENT_LABEL: Record<Intent, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  both: 'Buyer & seller',
  investor: 'Investor',
  renter: 'Renter',
  unknown: 'Not sure yet',
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  'cold-call': 'Cold call',
  'open-house': 'Open house',
  referral: 'Referral',
  'social-media': 'Social media',
  website: 'Website',
  mailer: 'Mailer',
  other: 'Other',
};

export const PIPELINE_LABEL: Record<PipelineStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  'appointment-set': 'Appointment set',
  active: 'Actively working',
  'under-contract': 'Under contract',
  closed: 'Closed',
  lost: 'Lost',
};

/** Stages where no follow-up cadence should run. */
export const DORMANT_STAGES: readonly PipelineStage[] = ['closed', 'lost'];

export function displayName(contact: Contact): string {
  return `${contact.preferredName ?? contact.firstName} ${contact.lastName}`.trim();
}

/**
 * The contact's own postal address (never a listing/`seller.propertyAddress`),
 * split into display lines from whichever canonical parts exist. Free-text
 * `mailingAddress` is shown as entered — no parsing or geocoding.
 */
export function contactAddressLines(
  contact: Pick<Contact, 'mailingAddress' | 'city' | 'state' | 'postalCode'>,
): string[] {
  const clean = (value: string | undefined) => value?.trim() || undefined;
  const street = clean(contact.mailingAddress);
  const region = [clean(contact.state), clean(contact.postalCode)].filter(Boolean).join(' ');
  const locality = [clean(contact.city), region || undefined].filter(Boolean).join(', ');
  return [street, locality || undefined].filter((line): line is string => Boolean(line));
}

export function initials(contact: Contact): string {
  const first = (contact.preferredName ?? contact.firstName).charAt(0);
  return `${first}${contact.lastName.charAt(0)}`.toUpperCase();
}
