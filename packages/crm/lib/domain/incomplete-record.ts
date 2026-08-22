import type { Contact } from './contact.ts';

export const INCOMPLETE_RECORD_STATUSES = ['pending', 'converted', 'archived'] as const;
export type IncompleteRecordStatus = (typeof INCOMPLETE_RECORD_STATUSES)[number];

export const INCOMPLETE_CONVERSION_ACTIONS = ['create', 'update', 'unchanged'] as const;
export type IncompleteConversionAction = (typeof INCOMPLETE_CONVERSION_ACTIONS)[number];

export interface IncompleteCandidate {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly preferredName?: string;
  readonly phone?: string;
  readonly secondaryPhone?: string;
  readonly email?: string;
  readonly mailingAddress?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly birthdate?: string;
  readonly homePurchaseDate?: string;
  readonly leadType?: Contact['leadType'];
  readonly relationship?: Contact['relationship'];
  readonly intent?: Contact['intent'];
  readonly source?: Contact['source'];
  readonly pipelineStage?: Contact['pipelineStage'];
  readonly tags?: readonly string[];
  readonly emailSubscribed?: boolean;
}

export interface IncompleteValidationReason {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface IncompleteRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly source: string;
  readonly externalId?: string;
  readonly intakeIdempotencyKey?: string;
  readonly candidate: IncompleteCandidate;
  readonly reasons: readonly IncompleteValidationReason[];
  readonly status: IncompleteRecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly convertedContactId?: string;
  readonly conversionAction?: IncompleteConversionAction;
  readonly conversionIdempotencyKey?: string;
  readonly convertedAt?: string;
  readonly convertedByMembershipId?: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
  readonly archiveReason?: string;
}

export interface IncompleteContactConversionPlan {
  readonly action: IncompleteConversionAction;
  readonly matchedContactId?: string;
  readonly matchedBy?: 'external-id' | 'email' | 'phone';
  readonly contactInput?: Omit<Contact, 'id' | 'createdAt'>;
  readonly contactPatch?: Partial<Contact>;
  readonly changes: readonly string[];
}

export interface IncompleteConversionReceipt {
  readonly record: IncompleteRecord;
  readonly contactId: string;
  readonly action: IncompleteConversionAction;
  readonly noOp: boolean;
}

export class IncompleteRecordError extends Error {
  readonly code: 'invalid-input' | 'not-found' | 'conflict' | 'forbidden' | 'scope-mismatch';
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    code: IncompleteRecordError['code'],
    message: string,
    fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'IncompleteRecordError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export interface IncompleteCandidateProjection {
  readonly eligible: true;
  readonly candidate: IncompleteCandidate;
  readonly reasons: readonly IncompleteValidationReason[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ENUMS = {
  leadType: ['hot', 'warm', 'nurture'],
  relationship: ['lead', 'active-client', 'past-client', 'sphere'],
  intent: ['buyer', 'seller', 'both', 'investor', 'renter', 'unknown'],
  source: ['cold-call', 'open-house', 'referral', 'social-media', 'website', 'mailer', 'other'],
  pipelineStage: ['new', 'contacted', 'appointment-set', 'active', 'under-contract', 'closed', 'lost'],
} as const;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ');
  return clean || undefined;
}

function boundedText(
  value: unknown,
  field: string,
  max: number,
  reasons: IncompleteValidationReason[],
): string | undefined {
  const clean = cleanText(value);
  if (!clean) return undefined;
  if (clean.length <= max) return clean;
  reasons.push({ field, code: 'too-long', message: `${field} must be ${max} characters or fewer.` });
  return clean.slice(0, max);
}

function dateOnly(
  value: unknown,
  field: string,
  reasons: IncompleteValidationReason[],
): string | undefined {
  const clean = boundedText(value, field, 10, reasons);
  if (!clean) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (
      date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() === Number(match[2]) - 1
      && date.getUTCDate() === Number(match[3])
    ) return clean;
  }
  reasons.push({ field, code: 'invalid-date', message: `${field} must use a valid YYYY-MM-DD date.` });
  return clean;
}

function enumValue<K extends keyof typeof ENUMS>(
  input: Record<string, unknown>,
  field: K,
  reasons: IncompleteValidationReason[],
): IncompleteCandidate[K] {
  const clean = cleanText(input[field]);
  if (!clean) return undefined as IncompleteCandidate[K];
  const normalized = clean.toLowerCase().replace(/[ _]+/g, '-');
  const allowed = ENUMS[field] as readonly string[];
  if (allowed.includes(normalized)) return normalized as IncompleteCandidate[K];
  reasons.push({ field, code: 'invalid-enum', message: `${field} is not an allowlisted value.` });
  return undefined as IncompleteCandidate[K];
}

function tagsValue(value: unknown, reasons: IncompleteValidationReason[]): readonly string[] | undefined {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(/[,;|]/) : [];
  const tags = Array.from(new Set(items.flatMap((item, index) => {
    const clean = boundedText(item, `tags.${index}`, 80, reasons);
    return clean ? [clean] : [];
  })));
  if (tags.length > 50) {
    reasons.push({ field: 'tags', code: 'too-many', message: 'tags accepts 50 values or fewer.' });
    return tags.slice(0, 50);
  }
  return tags.length ? tags : undefined;
}

function importedReasons(value: unknown): IncompleteValidationReason[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((entry, index) => {
    if (typeof entry === 'string') {
      const message = cleanText(entry);
      return message ? [{ field: 'candidate', code: `source-validation-${index + 1}`, message }] : [];
    }
    const reason = object(entry);
    const field = cleanText(reason.field);
    const code = cleanText(reason.code);
    const message = cleanText(reason.message);
    return field && code && message ? [{ field, code, message }] : [];
  });
}

/**
 * Projects only contact fields from an already-authenticated intake/import row.
 * Unknown keys, raw bodies, headers, notes and secrets have no output path.
 */
export function projectIncompleteCandidate(
  raw: unknown,
  sourceReasons: unknown = [],
  externalId?: string,
): IncompleteCandidateProjection {
  const input = object(raw);
  const reasons = importedReasons(sourceReasons);
  const firstName = boundedText(input.firstName, 'firstName', 120, reasons);
  const lastName = boundedText(input.lastName, 'lastName', 120, reasons);
  const preferredName = boundedText(input.preferredName, 'preferredName', 120, reasons);
  const email = boundedText(input.email, 'email', 254, reasons)?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    reasons.push({ field: 'email', code: 'invalid-email', message: 'email is invalid.' });
  }
  const phoneRaw = boundedText(input.phone, 'phone', 40, reasons);
  const secondaryPhoneRaw = boundedText(input.secondaryPhone, 'secondaryPhone', 40, reasons);
  const phone = phoneRaw?.replace(/\D/g, '');
  const secondaryPhone = secondaryPhoneRaw?.replace(/\D/g, '');
  if (phone && (phone.length < 7 || phone.length > 15)) {
    reasons.push({ field: 'phone', code: 'invalid-phone', message: 'phone must contain 7–15 digits.' });
  }
  if (secondaryPhone && (secondaryPhone.length < 7 || secondaryPhone.length > 15)) {
    reasons.push({
      field: 'secondaryPhone',
      code: 'invalid-phone',
      message: 'secondaryPhone must contain 7–15 digits.',
    });
  }
  const emailSubscribed = typeof input.emailSubscribed === 'boolean' ? input.emailSubscribed : undefined;
  if (input.emailSubscribed !== undefined && emailSubscribed === undefined) {
    reasons.push({
      field: 'emailSubscribed',
      code: 'invalid-boolean',
      message: 'emailSubscribed must be true or false.',
    });
  }
  const mailingAddress = boundedText(input.mailingAddress, 'mailingAddress', 300, reasons);
  const city = boundedText(input.city, 'city', 120, reasons);
  const state = boundedText(input.state, 'state', 80, reasons);
  const postalCode = boundedText(input.postalCode, 'postalCode', 24, reasons);
  const birthdate = dateOnly(input.birthdate, 'birthdate', reasons);
  const homePurchaseDate = dateOnly(input.homePurchaseDate, 'homePurchaseDate', reasons);
  const leadType = enumValue(input, 'leadType', reasons);
  const relationship = enumValue(input, 'relationship', reasons);
  const intent = enumValue(input, 'intent', reasons);
  const source = enumValue(input, 'source', reasons);
  const pipelineStage = enumValue(input, 'pipelineStage', reasons);
  const tags = tagsValue(input.tags, reasons);

  const candidate: IncompleteCandidate = {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(preferredName ? { preferredName } : {}),
    ...(phone ? { phone } : {}),
    ...(secondaryPhone ? { secondaryPhone } : {}),
    ...(email ? { email } : {}),
    ...(mailingAddress ? { mailingAddress } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(birthdate ? { birthdate } : {}),
    ...(homePurchaseDate ? { homePurchaseDate } : {}),
    ...(leadType ? { leadType } : {}),
    ...(relationship ? { relationship } : {}),
    ...(intent ? { intent } : {}),
    ...(source ? { source } : {}),
    ...(pipelineStage ? { pipelineStage } : {}),
    ...(tags ? { tags } : {}),
    ...(emailSubscribed === undefined ? {} : { emailSubscribed }),
  };

  if (!candidate.firstName && !candidate.lastName && !candidate.phone && !candidate.email && !cleanText(externalId)) {
    throw new IncompleteRecordError(
      'invalid-input',
      'Rejected payload has no safe identity signal and cannot enter quarantine.',
      { candidate: 'Provide a name, phone, email, or provider external ID.' },
    );
  }
  if (reasons.length === 0) {
    reasons.push({
      field: 'candidate',
      code: 'incomplete-contact',
      message: 'Candidate requires review before contact conversion.',
    });
  }
  return { eligible: true, candidate, reasons };
}

export function hasSafeIdentity(candidate: IncompleteCandidate, externalId?: string): boolean {
  return Boolean(
    candidate.firstName
    || candidate.lastName
    || candidate.phone
    || candidate.email
    || cleanText(externalId),
  );
}

export function archiveIncompleteRecord(
  record: IncompleteRecord,
  actorMembershipId: string,
  archivedAt: string,
  reason: string,
): { record: IncompleteRecord; noOp: boolean } {
  if (record.status === 'converted') {
    throw new IncompleteRecordError('conflict', 'Converted records cannot be archived.');
  }
  if (record.status === 'archived') return { record, noOp: true };
  return {
    noOp: false,
    record: {
      ...record,
      status: 'archived',
      updatedAt: archivedAt,
      archivedAt,
      archivedByMembershipId: actorMembershipId,
      archiveReason: reason,
    },
  };
}

export function restoreIncompleteRecord(
  record: IncompleteRecord,
  restoredAt: string,
): { record: IncompleteRecord; noOp: boolean } {
  if (record.status === 'pending') return { record, noOp: true };
  if (record.status === 'converted') {
    throw new IncompleteRecordError('conflict', 'Converted records cannot return to pending.');
  }
  const restored: Mutable<IncompleteRecord> = { ...record, status: 'pending', updatedAt: restoredAt };
  delete restored.archivedAt;
  delete restored.archivedByMembershipId;
  delete restored.archiveReason;
  return { record: restored, noOp: false };
}

export function markIncompleteRecordConverted(
  record: IncompleteRecord,
  input: {
    contactId: string;
    action: IncompleteConversionAction;
    idempotencyKey: string;
    actorMembershipId: string;
    convertedAt: string;
  },
): IncompleteConversionReceipt {
  if (record.status === 'converted') {
    if (!record.convertedContactId || !record.conversionAction) {
      throw new IncompleteRecordError('conflict', 'Converted record is missing its immutable receipt.');
    }
    if (
      record.conversionIdempotencyKey !== input.idempotencyKey
      && record.convertedContactId !== input.contactId
    ) {
      throw new IncompleteRecordError('conflict', 'Record was already converted by another request.');
    }
    return {
      record,
      contactId: record.convertedContactId,
      action: record.conversionAction,
      noOp: true,
    };
  }
  if (record.status !== 'pending') {
    throw new IncompleteRecordError('conflict', 'Archived records must be restored before conversion.');
  }
  const converted: IncompleteRecord = {
    ...record,
    status: 'converted',
    updatedAt: input.convertedAt,
    convertedContactId: input.contactId,
    conversionAction: input.action,
    conversionIdempotencyKey: input.idempotencyKey,
    convertedAt: input.convertedAt,
    convertedByMembershipId: input.actorMembershipId,
  };
  return { record: converted, contactId: input.contactId, action: input.action, noOp: false };
}
