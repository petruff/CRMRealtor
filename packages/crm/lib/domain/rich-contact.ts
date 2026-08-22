import type { WorkspaceScope } from './workspace.ts';

export const CONTACT_POINT_TYPES = ['phone', 'email'] as const;
export type ContactPointType = (typeof CONTACT_POINT_TYPES)[number];
export const CONTACT_POINT_LIMITS: Readonly<Record<ContactPointType, number>> = {
  phone: 3,
  email: 2,
};

export const PERSON_RELATIONSHIP_KINDS = [
  'spouse', 'partner', 'household-member', 'other',
] as const;
export type PersonRelationshipKind = (typeof PERSON_RELATIONSHIP_KINDS)[number];

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'single-select'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const MORTGAGE_TYPES = ['conventional', 'fha', 'va', 'cash', 'unknown'] as const;
export type MortgageType = (typeof MORTGAGE_TYPES)[number];
export const TENURE_TYPES = ['owns', 'rents', 'unknown'] as const;
export type TenureType = (typeof TENURE_TYPES)[number];
export const PROPERTY_TO_SELL_TYPES = ['yes', 'no', 'maybe', 'unknown'] as const;
export type PropertyToSell = (typeof PROPERTY_TO_SELL_TYPES)[number];

export interface ContactPoint {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly type: ContactPointType;
  readonly label: string;
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly isPrimary: boolean;
  readonly emailSubscribed?: boolean;
  readonly displayOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
  readonly archiveReason?: string;
}

export interface Household {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
}

export interface HouseholdMembership {
  readonly id: string;
  readonly workspaceId: string;
  readonly householdId: string;
  readonly contactId: string;
  readonly createdAt: string;
  readonly createdByMembershipId: string;
  readonly endedAt?: string;
  readonly endedByMembershipId?: string;
}

export interface PersonRelationship {
  readonly id: string;
  readonly workspaceId: string;
  readonly firstContactId: string;
  readonly secondContactId: string;
  readonly kind: PersonRelationshipKind;
  readonly label?: string;
  readonly createdAt: string;
  readonly createdByMembershipId: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
}

export interface ContactAssignment {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly assigneeMembershipId: string;
  readonly assignedAt: string;
  readonly assignedByMembershipId: string;
  readonly unassignedAt?: string;
  readonly unassignedByMembershipId?: string;
}

export interface CustomFieldDefinition {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly type: CustomFieldType;
  readonly options: readonly string[];
  readonly displayOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
}

export type CustomFieldValue = string | number | boolean;

export interface ContactCustomFieldValue {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly definitionId: string;
  readonly value: CustomFieldValue;
  readonly updatedAt: string;
  readonly updatedByMembershipId: string;
}

export const CONTACT_IMPORT_SOURCE_FACT_CATEGORIES = [
  'identity', 'ownership', 'address', 'real-estate', 'engagement', 'verification', 'consent', 'other',
] as const;
export type ContactImportSourceFactCategory = (typeof CONTACT_IMPORT_SOURCE_FACT_CATEGORIES)[number];

export const CONTACT_IMPORT_SOURCE_FACT_VALUE_TYPES = [
  'text', 'number', 'boolean', 'date', 'timestamp',
] as const;
export type ContactImportSourceFactValueType = (typeof CONTACT_IMPORT_SOURCE_FACT_VALUE_TYPES)[number];

/** Immutable source-native provenance. `value` is evidence and never grants messaging consent. */
export interface ContactImportSourceFactRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly contactId: string;
  readonly provider: string;
  readonly schemaVersion: string;
  readonly key: string;
  readonly label: string;
  readonly category: ContactImportSourceFactCategory;
  readonly valueType: ContactImportSourceFactValueType;
  readonly value: string | number | boolean;
  readonly valueHash: string;
  readonly sourceRowNumber?: number;
  readonly groupIdempotencyKey: string;
  readonly requestHash: string;
  readonly capturedAt: string;
}

export interface ContactArchiveRecord {
  readonly contactId: string;
  readonly workspaceId: string;
  readonly archivedAt?: string;
  readonly archivedByMembershipId?: string;
  readonly archiveReason?: string;
}

export type RichContactErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'conflict'
  | 'forbidden'
  | 'scope-mismatch';

export class RichContactError extends Error {
  readonly code: RichContactErrorCode;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    code: RichContactErrorCode,
    message: string,
    fieldErrors: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'RichContactError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function parseRichContactIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw new RichContactError('invalid-input', `${field} is invalid.`, {
      [field]: 'Use 1–128 letters, numbers, dashes, or underscores.',
    });
  }
  return value.trim();
}

export function parseRichContactText(
  value: unknown,
  field: string,
  max: number,
  optional = false,
): string | undefined {
  if ((value === undefined || value === null || value === '') && optional) return undefined;
  if (typeof value !== 'string') {
    throw new RichContactError('invalid-input', `${field} is required.`, { [field]: 'Enter text.' });
  }
  const clean = value.trim();
  if ((!clean && !optional) || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new RichContactError('invalid-input', `${field} is invalid.`, {
      [field]: `Use ${optional ? 'up to' : '1–'}${max} printable characters.`,
    });
  }
  return clean || undefined;
}

export function parseRichContactInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RichContactError('invalid-input', `${field} is required.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new RichContactError('invalid-input', `${field} must be an ISO date/time.`);
  }
  return parsed.toISOString();
}

export function normalizeContactPhone(value: unknown): { displayValue: string; normalizedValue: string } {
  const displayValue = parseRichContactText(value, 'displayValue', 40) ?? '';
  let normalizedValue = displayValue.replace(/\D/g, '');
  if (normalizedValue.length === 11 && normalizedValue.startsWith('1')) {
    normalizedValue = normalizedValue.slice(1);
  }
  if (normalizedValue.length < 7 || normalizedValue.length > 15) {
    throw new RichContactError('invalid-input', 'Phone number is invalid.', {
      displayValue: 'Use a phone number containing 7–15 digits.',
    });
  }
  return { displayValue, normalizedValue };
}

export function normalizeContactEmail(value: unknown): { displayValue: string; normalizedValue: string } {
  const displayValue = parseRichContactText(value, 'displayValue', 254) ?? '';
  const normalizedValue = displayValue.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)) {
    throw new RichContactError('invalid-input', 'Email address is invalid.', {
      displayValue: 'Enter a valid email address.',
    });
  }
  return { displayValue, normalizedValue };
}

export function normalizeContactPointValue(type: ContactPointType, value: unknown) {
  return type === 'phone' ? normalizeContactPhone(value) : normalizeContactEmail(value);
}

export function canonicalRelationshipPair(
  firstContactId: unknown,
  secondContactId: unknown,
): readonly [string, string] {
  const first = parseRichContactIdentifier(firstContactId, 'firstContactId');
  const second = parseRichContactIdentifier(secondContactId, 'secondContactId');
  if (first === second) throw new RichContactError('conflict', 'A contact cannot relate to themselves.');
  return first.localeCompare(second) < 0 ? [first, second] : [second, first];
}

export function parseRelationshipKind(
  value: unknown,
  labelValue?: unknown,
): { kind: PersonRelationshipKind; label?: string } {
  if (!PERSON_RELATIONSHIP_KINDS.includes(value as PersonRelationshipKind)) {
    throw new RichContactError('invalid-input', 'Relationship kind is invalid.');
  }
  const kind = value as PersonRelationshipKind;
  const label = parseRichContactText(labelValue, 'label', 80, true);
  if (kind === 'other' && !label) {
    throw new RichContactError('invalid-input', 'Other relationships require a label.', {
      label: 'Enter a relationship label.',
    });
  }
  if (kind !== 'other' && label) {
    throw new RichContactError('invalid-input', 'Fixed relationship kinds cannot have another label.');
  }
  return { kind, ...(label ? { label } : {}) };
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RichContactError('invalid-input', 'Custom date value is invalid.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== (month ?? 1) - 1
    || parsed.getUTCDate() !== day) {
    throw new RichContactError('invalid-input', 'Custom date value is invalid.');
  }
  return value;
}

export function validateCustomFieldValue(
  definition: CustomFieldDefinition,
  value: unknown,
): CustomFieldValue {
  if (definition.archivedAt) throw new RichContactError('conflict', 'Archived custom fields cannot be changed.');
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') throw new RichContactError('invalid-input', 'Custom value must be boolean.');
    return value;
  }
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
      throw new RichContactError('invalid-input', 'Custom value must be a bounded number.');
    }
    return value;
  }
  const text = parseRichContactText(value, 'value', definition.type === 'text' ? 2_000 : 120) ?? '';
  if (definition.type === 'date') return isoDate(text);
  if (definition.type === 'single-select' && !definition.options.includes(text)) {
    throw new RichContactError('invalid-input', 'Custom value is not an allowed option.');
  }
  return text;
}

export function requireOwnerScope(scope: WorkspaceScope): void {
  if (scope.role !== 'owner') {
    throw new RichContactError('forbidden', 'Workspace owner access is required.');
  }
}
