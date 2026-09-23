import {
  DORMANT_STAGES,
  NoteEditError,
  type BuyerCriteria,
  type Contact,
  type Intent,
  type LeadSource,
  type LeadType,
  type PipelineStage,
  type QualificationStatus,
  type Relationship,
  type SellerCriteria,
} from '@/lib/domain/contact';
import {
  ensureNextTouch,
  overrideNextTouch,
  recordTouch,
} from '@/lib/domain/cadence';
import { appendActivityEventCommand } from '@/lib/application/activity-commands';
import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { ContactRepository } from '@/lib/data/repository';
import type { WorkspaceScope } from '@/lib/domain/workspace';

export interface ContactActivityContext {
  readonly repository: ActivityRepository;
  readonly scope: WorkspaceScope;
}

async function appendContactActivity(
  context: ContactActivityContext | undefined,
  input: {
    type: 'contact-created' | 'contact-updated' | 'note-added' | 'touch-recorded';
    contactId: string;
    idempotencyKey: string;
    metadata?: Readonly<Record<string, string | number | boolean | null>>;
  },
  now: Date,
): Promise<void> {
  if (!context) return;
  await appendActivityEventCommand(context.repository, context.scope, input, now);
}

const LEAD_TYPES = ['hot', 'warm', 'nurture'] as const;
const RELATIONSHIPS = ['lead', 'active-client', 'past-client', 'sphere'] as const;
const INTENTS = ['buyer', 'seller', 'both', 'investor', 'renter', 'unknown'] as const;
const SOURCES = [
  'cold-call',
  'open-house',
  'referral',
  'social-media',
  'website',
  'mailer',
  'other',
] as const;
const PIPELINE_STAGES = [
  'new',
  'contacted',
  'appointment-set',
  'active',
  'under-contract',
  'closed',
  'lost',
] as const;
const QUALIFICATION_STATUSES = ['qualified', 'needs-qualification'] as const;

export type ContactFieldErrors = Record<string, string>;

export class ContactCommandError extends Error {
  readonly fieldErrors: ContactFieldErrors;

  constructor(message: string, fieldErrors: ContactFieldErrors = {}) {
    super(message);
    this.name = 'ContactCommandError';
    this.fieldErrors = fieldErrors;
  }
}

export function isContactCommandError(error: unknown): error is ContactCommandError {
  return error instanceof ContactCommandError;
}

interface EditableContactFields {
  firstName: string;
  lastName: string;
  preferredName?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  mailingAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  birthdate?: string;
  homePurchaseDate?: string;
  leadType: LeadType;
  qualificationStatus: QualificationStatus;
  relationship: Relationship;
  intent: Intent;
  source: LeadSource;
  pipelineStage: PipelineStage;
  buyer?: BuyerCriteria;
  seller?: SellerCriteria;
  referredById?: string;
  nextTouchAt?: string;
  tags: string[];
  emailSubscribed: boolean;
}

function value(formData: FormData, key: string): string {
  const entry = formData.get(key);
  return typeof entry === 'string' ? entry.trim() : '';
}

function optional(formData: FormData, key: string): string | undefined {
  return value(formData, key) || undefined;
}

function boundedOptional(formData: FormData, key: string, max = 80): string | undefined {
  const input = optional(formData, key);
  if (!input) return undefined;
  if (input.length > max || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new ContactCommandError('Review the highlighted fields.', {
      [key]: `Use up to ${max} printable characters.`,
    });
  }
  return input;
}

function optionalOneOf<T extends string>(
  formData: FormData,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const input = optional(formData, key);
  if (!input) return undefined;
  if (!allowed.includes(input as T)) {
    throw new ContactCommandError('Review the highlighted fields.', {
      [key]: 'Choose a valid option.',
    });
  }
  return input as T;
}

function oneOf<T extends string>(
  formData: FormData,
  key: string,
  allowed: readonly T[],
): T {
  const input = value(formData, key);
  if (!allowed.includes(input as T)) {
    throw new ContactCommandError('Review the highlighted fields.', {
      [key]: 'Choose a valid option.',
    });
  }
  return input as T;
}

function dateValue(formData: FormData, key: string): string | undefined {
  const input = optional(formData, key);
  if (!input) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new ContactCommandError('Review the highlighted fields.', {
      [key]: 'Enter a valid date.',
    });
  }

  const [year, month, day] = input.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== (month ?? 1) - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ContactCommandError('Review the highlighted fields.', {
      [key]: 'Enter a valid date.',
    });
  }
  return input;
}

function nonNegativeNumber(formData: FormData, key: string): number | undefined {
  const input = optional(formData, key);
  if (!input) return undefined;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ContactCommandError('Review the highlighted fields.', {
      [key]: 'Enter zero or a positive number.',
    });
  }
  return parsed;
}

function emailValue(formData: FormData): string | undefined {
  const email = optional(formData, 'email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ContactCommandError('Review the highlighted fields.', {
      email: 'Enter a valid email address.',
    });
  }
  return email;
}

function commaList(input: string | undefined): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function buyerCriteria(formData: FormData): BuyerCriteria | undefined {
  const preApproved = value(formData, 'buyerPreApproved');
  if (preApproved && preApproved !== 'yes' && preApproved !== 'no') {
    throw new ContactCommandError('Review the highlighted fields.', {
      buyerPreApproved: 'Choose a valid option.',
    });
  }

  const buyer: BuyerCriteria = {
    priceMin: nonNegativeNumber(formData, 'buyerPriceMin'),
    priceMax: nonNegativeNumber(formData, 'buyerPriceMax'),
    areas: commaList(optional(formData, 'buyerAreas')),
    beds: nonNegativeNumber(formData, 'buyerBeds'),
    baths: nonNegativeNumber(formData, 'buyerBaths'),
    timeline: optional(formData, 'buyerTimeline'),
    preApproved: preApproved ? preApproved === 'yes' : undefined,
    lender: boundedOptional(formData, 'buyerLender', 120),
    mortgageType: optionalOneOf(formData, 'buyerMortgageType', [
      'conventional', 'fha', 'va', 'cash', 'unknown',
    ] as const),
    desiredPropertyType: boundedOptional(formData, 'buyerDesiredPropertyType'),
    currentTenure: optionalOneOf(formData, 'buyerCurrentTenure', [
      'owns', 'rents', 'unknown',
    ] as const),
  };

  if (
    buyer.priceMin === undefined &&
    buyer.priceMax === undefined &&
    buyer.areas?.length === 0 &&
    buyer.beds === undefined &&
    buyer.baths === undefined &&
    !buyer.timeline &&
    buyer.preApproved === undefined &&
    !buyer.lender &&
    buyer.mortgageType === undefined &&
    !buyer.desiredPropertyType &&
    buyer.currentTenure === undefined
  ) {
    return undefined;
  }
  if (buyer.areas?.length === 0) delete buyer.areas;
  return buyer;
}

function sellerCriteria(formData: FormData): SellerCriteria | undefined {
  const seller: SellerCriteria = {
    propertyAddress: optional(formData, 'sellerPropertyAddress'),
    targetPrice: nonNegativeNumber(formData, 'sellerTargetPrice'),
    timeline: optional(formData, 'sellerTimeline'),
    motivation: optional(formData, 'sellerMotivation'),
    hasPropertyToSell: optionalOneOf(formData, 'sellerHasPropertyToSell', [
      'yes', 'no', 'maybe', 'unknown',
    ] as const),
    propertyType: boundedOptional(formData, 'sellerPropertyType'),
    basement: boundedOptional(formData, 'sellerBasement'),
    parking: boundedOptional(formData, 'sellerParking'),
    condition: boundedOptional(formData, 'sellerCondition'),
    listingStatus: boundedOptional(formData, 'sellerListingStatus'),
    bedrooms: nonNegativeNumber(formData, 'sellerBedrooms'),
    bathrooms: nonNegativeNumber(formData, 'sellerBathrooms'),
  };

  return Object.values(seller).some((entry) => entry !== undefined) ? seller : undefined;
}

export function parseContactForm(formData: FormData): EditableContactFields {
  const firstName = value(formData, 'firstName');
  const lastName = value(formData, 'lastName');
  if (!firstName && !lastName) {
    throw new ContactCommandError('Enter at least a first or last name.', {
      firstName: 'Enter a first or last name.',
      lastName: 'Enter a first or last name.',
    });
  }

  const relationship = oneOf(formData, 'relationship', RELATIONSHIPS);
  const email = emailValue(formData);
  const requestedLeadType = optionalOneOf(formData, 'leadType', LEAD_TYPES);
  if (relationship !== 'past-client' && !requestedLeadType) {
    throw new ContactCommandError('Review the highlighted fields.', {
      leadType: 'Choose a follow-up priority.',
    });
  }

  return {
    firstName,
    lastName,
    preferredName: optional(formData, 'preferredName'),
    phone: optional(formData, 'phone'),
    secondaryPhone: optional(formData, 'secondaryPhone'),
    email,
    mailingAddress: optional(formData, 'mailingAddress'),
    city: optional(formData, 'city'),
    state: optional(formData, 'state'),
    postalCode: optional(formData, 'postalCode'),
    birthdate: dateValue(formData, 'birthdate'),
    homePurchaseDate: dateValue(formData, 'homePurchaseDate'),
    // Past clients are relationships, not active leads. The legacy database
    // enum remains non-null, so Nurture is retained only as a compatibility
    // value and is intentionally hidden from client-facing lead badges.
    leadType: relationship === 'past-client' ? 'nurture' : requestedLeadType!,
    qualificationStatus: optionalOneOf(formData, 'qualificationStatus', QUALIFICATION_STATUSES) ?? 'qualified',
    relationship,
    intent: oneOf(formData, 'intent', INTENTS),
    source: oneOf(formData, 'source', SOURCES),
    pipelineStage: oneOf(formData, 'pipelineStage', PIPELINE_STAGES),
    buyer: buyerCriteria(formData),
    seller: sellerCriteria(formData),
    referredById: optional(formData, 'referredById'),
    nextTouchAt: dateValue(formData, 'nextTouchAt'),
    tags: commaList(optional(formData, 'tags')),
    emailSubscribed: Boolean(email) && formData.get('emailSubscribed') === 'on',
  };
}

export function createContactInput(
  formData: FormData,
  now = new Date(),
): Omit<Contact, 'id' | 'createdAt'> {
  const fields = parseContactForm(formData);
  const candidate: Contact = {
    ...fields,
    id: 'pending',
    createdAt: now.toISOString(),
    touchDateOverridden: false,
  };
  const scheduled = fields.nextTouchAt
    ? overrideNextTouch(candidate, fields.nextTouchAt)
    : ensureNextTouch(candidate, now);
  const input = { ...scheduled } as Partial<Contact>;
  delete input.id;
  delete input.createdAt;
  return input as Omit<Contact, 'id' | 'createdAt'>;
}

export async function createContactCommand(
  repository: ContactRepository,
  formData: FormData,
  now = new Date(),
  activity?: ContactActivityContext,
): Promise<Contact> {
  const input = createContactInput(formData, now);
  const created = await repository.create(input);
  await appendContactActivity(activity, {
    type: 'contact-created',
    contactId: created.id,
    idempotencyKey: `contact-created:${created.id}`,
  }, now);
  return created;
}

export async function updateContactCommand(
  repository: ContactRepository,
  id: string,
  formData: FormData,
  now = new Date(),
  activity?: ContactActivityContext,
): Promise<Contact> {
  const existing = await repository.get(id);
  if (!existing) throw new ContactCommandError('Contact not found.');

  const fields = parseContactForm(formData);
  if (fields.referredById === id) {
    throw new ContactCommandError('A contact cannot refer themselves.', {
      referredById: 'Choose another contact.',
    });
  }

  let next: Contact = { ...existing, ...fields };
  if (DORMANT_STAGES.includes(next.pipelineStage)) {
    next = { ...next, nextTouchAt: undefined, touchDateOverridden: false };
  } else if (!fields.nextTouchAt) {
    next = ensureNextTouch(
      { ...next, nextTouchAt: undefined, touchDateOverridden: false },
      now,
    );
  } else if (fields.nextTouchAt !== existing.nextTouchAt) {
    next = overrideNextTouch(next, fields.nextTouchAt);
  } else {
    next = { ...next, touchDateOverridden: existing.touchDateOverridden };
  }

  const patch: Partial<Contact> = {
    ...fields,
    nextTouchAt: next.nextTouchAt,
    touchDateOverridden: next.touchDateOverridden,
  };
  const updated = await repository.update(id, patch);
  await appendContactActivity(activity, {
    type: 'contact-updated',
    contactId: updated.id,
    idempotencyKey: `contact-updated:${updated.id}:${now.getTime()}`,
  }, now);
  return updated;
}

export async function addContactNoteCommand(
  repository: ContactRepository,
  contactId: string,
  formData: FormData,
  now = new Date(),
  activity?: ContactActivityContext,
) {
  const contact = await repository.get(contactId);
  if (!contact) throw new ContactCommandError('Contact not found.');

  const body = value(formData, 'body');
  if (!body) {
    throw new ContactCommandError('Write a note before saving.', {
      body: 'A note cannot be blank.',
    });
  }
  const note = await repository.addNote(contactId, body);
  await appendContactActivity(activity, {
    type: 'note-added',
    contactId,
    idempotencyKey: `note-added:${note.id}`,
  }, now);
  return note;
}

export async function archiveContactNoteCommand(
  repository: ContactRepository,
  contactId: string,
  noteId: string,
  formData: FormData,
  correlationId: string,
  now = new Date(),
) {
  const contact = await repository.get(contactId);
  if (!contact) throw new ContactCommandError('Contact not found.');
  if (!repository.archiveNote) throw new ContactCommandError('Note archiving is unavailable in this workspace.');
  const reason = value(formData, 'reason');
  if (reason.length < 3 || reason.length > 500) {
    throw new ContactCommandError('Explain why this note should be archived.', {
      reason: 'Use between 3 and 500 characters.',
    });
  }
  return repository.archiveNote(noteId, reason, correlationId, now.toISOString());
}

export const NOTE_EDIT_CONFLICT_MESSAGE =
  'This note was changed in another session. Your draft is still here — review the latest saved text below before saving again.';

/**
 * Corrects an active note in place. The browser supplies only the identifiers
 * and the draft; membership, workspace, note↔contact linkage and the read-only
 * rules are re-checked here and again inside the database RPC.
 */
export async function editContactNoteCommand(
  repository: ContactRepository,
  contactId: string,
  noteId: string,
  formData: FormData,
  correlationId: string,
  now = new Date(),
) {
  const contact = await repository.get(contactId);
  if (!contact) throw new ContactCommandError('Contact not found.');
  if (contact.archivedAt) throw new ContactCommandError('Restore this contact before editing its notes.');
  if (!repository.editNote) throw new ContactCommandError('Note editing is unavailable in this workspace.');

  // Browsers submit textarea line breaks as CRLF; store one canonical form.
  const body = value(formData, 'body').replace(/\r\n?/g, '\n');
  if (!body) {
    throw new ContactCommandError('Write a note before saving.', {
      body: 'A note cannot be blank.',
    });
  }
  const expectedRevision = Number(value(formData, 'revision'));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new ContactCommandError('Refresh this contact before editing the note.');
  }

  // Workspace-scoped read (RLS + merged-contact group) proves the note belongs here.
  const note = (await repository.notesFor(contactId, { includeArchived: true }))
    .find((entry) => entry.id === noteId);
  if (!note) throw new ContactCommandError('That note was not found on this contact.');
  if (note.archivedAt) throw new ContactCommandError('Restore this note before editing it.');
  if ((note.revision ?? 1) !== expectedRevision) throw new ContactCommandError(NOTE_EDIT_CONFLICT_MESSAGE);

  try {
    return await repository.editNote({
      noteId,
      body,
      expectedRevision,
      correlationId,
      occurredAt: now.toISOString(),
    });
  } catch (error) {
    if (error instanceof NoteEditError) {
      if (error.code === 'conflict') throw new ContactCommandError(NOTE_EDIT_CONFLICT_MESSAGE);
      if (error.code === 'not-found') throw new ContactCommandError('That note was not found on this contact.');
      throw new ContactCommandError('Archived notes and contacts are read only until restored.');
    }
    throw error;
  }
}

export async function restoreContactNoteCommand(
  repository: ContactRepository,
  contactId: string,
  noteId: string,
  correlationId: string,
  now = new Date(),
) {
  const contact = await repository.get(contactId);
  if (!contact) throw new ContactCommandError('Contact not found.');
  if (!repository.restoreNote) throw new ContactCommandError('Note restoration is unavailable in this workspace.');
  return repository.restoreNote(noteId, correlationId, now.toISOString());
}

export async function recordContactTouchCommand(
  repository: ContactRepository,
  contactId: string,
  now = new Date(),
  activity?: ContactActivityContext,
): Promise<Contact> {
  const contact = await repository.get(contactId);
  if (!contact) throw new ContactCommandError('Contact not found.');

  const touched = recordTouch(contact, now);
  const updated = await repository.update(contactId, {
    lastContactedAt: touched.lastContactedAt,
    nextTouchAt: touched.nextTouchAt,
    touchDateOverridden: touched.touchDateOverridden,
    pipelineStage: touched.pipelineStage,
  });
  await appendContactActivity(activity, {
    type: 'touch-recorded',
    contactId: updated.id,
    idempotencyKey: `touch-recorded:${updated.id}:${touched.lastContactedAt}`,
  }, now);
  return updated;
}

export const FOLLOW_UP_CHOICES = ['cadence', 'tomorrow', 'three-days', 'next-week', 'two-weeks'] as const;
export type FollowUpChoice = (typeof FOLLOW_UP_CHOICES)[number];

const FOLLOW_UP_DAYS: Record<Exclude<FollowUpChoice, 'cadence'>, number> = {
  tomorrow: 1,
  'three-days': 3,
  'next-week': 7,
  'two-weeks': 14,
};

/**
 * One tap after a call: optional note, touch recorded, next follow-up set.
 * The note is saved first so a later failure never loses what she typed
 * without telling her; the touch uses the canonical cadence unless she picked
 * a specific follow-up, which is stored as a manual override.
 */
export async function recordConversationCommand(
  repository: ContactRepository,
  contactId: string,
  formData: FormData,
  now = new Date(),
  activity?: ContactActivityContext,
): Promise<Contact> {
  const contact = await repository.get(contactId);
  if (!contact) throw new ContactCommandError('Contact not found.');
  if (contact.archivedAt) throw new ContactCommandError('Restore this contact before logging a conversation.');
  const rawChoice = value(formData, 'followUp') || 'cadence';
  if (!FOLLOW_UP_CHOICES.includes(rawChoice as FollowUpChoice)) {
    throw new ContactCommandError('Choose when to follow up next.', { followUp: 'Pick one of the listed options.' });
  }
  const choice = rawChoice as FollowUpChoice;
  const note = value(formData, 'note').replace(/\r\n?/g, '\n');
  if (note.length > 5_000) {
    throw new ContactCommandError('That note is too long for a quick log.', { note: 'Use 5,000 characters or fewer, or use Log full outcome.' });
  }
  if (note) {
    const saved = await repository.addNote(contactId, note);
    await appendContactActivity(activity, { type: 'note-added', contactId, idempotencyKey: `note-added:${saved.id}` }, now);
  }
  let updated = await recordContactTouchCommand(repository, contactId, now, activity);
  if (choice !== 'cadence') {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + FOLLOW_UP_DAYS[choice]));
    const overridden = overrideNextTouch(updated, next.toISOString().slice(0, 10));
    updated = await repository.update(contactId, { nextTouchAt: overridden.nextTouchAt, touchDateOverridden: true });
  }
  return updated;
}
