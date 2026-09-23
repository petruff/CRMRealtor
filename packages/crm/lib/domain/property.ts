export const PROPERTY_KINDS = ['single-family', 'condo', 'townhouse', 'multifamily', 'land', 'commercial', 'other', 'unknown'] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];
export const PROPERTY_LIFECYCLES = ['off-market', 'coming-soon', 'active', 'pending', 'sold', 'withdrawn', 'unknown'] as const;
export type PropertyLifecycle = (typeof PROPERTY_LIFECYCLES)[number];
export const PROPERTY_FACT_FIELDS = ['bedrooms', 'bathrooms', 'square-feet', 'year-built', 'list-price-cents', 'association-name', 'flood-zone', 'parcel-reference', 'listing-status'] as const;
export type PropertyFactField = (typeof PROPERTY_FACT_FIELDS)[number];
export const PROPERTY_FACT_AUTHORITIES = ['manual', 'licensed-provider'] as const;
export type PropertyFactAuthority = (typeof PROPERTY_FACT_AUTHORITIES)[number];
export const PROPERTY_PERMISSION_STATES = ['allowed', 'restricted', 'revoked', 'unknown'] as const;
export type PropertyPermissionState = (typeof PROPERTY_PERMISSION_STATES)[number];
export const PROPERTY_INTEREST_TYPES = ['inquiry', 'saved', 'favorite', 'showing-intent', 'seller-owned', 'seller-prospect'] as const;
export type PropertyInterestType = (typeof PROPERTY_INTEREST_TYPES)[number];

export interface PropertyIdentity {
  readonly id: string;
  readonly workspaceId: string;
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly stateCode: string;
  readonly postalCode: string;
  readonly countryCode: 'US';
  readonly normalizedAddressKey: string;
  readonly kind: PropertyKind;
  readonly lifecycle: PropertyLifecycle;
  readonly version: number;
  readonly createdByMembershipId: string;
  readonly updatedByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PropertyFactValue = string | number | boolean;

export interface PropertyFact {
  readonly id: string;
  readonly workspaceId: string;
  readonly propertyId: string;
  readonly field: PropertyFactField;
  readonly value: PropertyFactValue;
  readonly authority: PropertyFactAuthority;
  readonly provider?: string;
  readonly providerRecordId?: string;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly permissionState: PropertyPermissionState;
  readonly displayUntil?: string;
  readonly retentionUntil?: string;
  readonly version: number;
  readonly recordedByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PropertyInterest {
  readonly id: string;
  readonly workspaceId: string;
  readonly propertyId: string;
  readonly contactId: string;
  readonly type: PropertyInterestType;
  readonly source: 'manual' | 'website' | 'licensed-provider';
  readonly sourceReference: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly archivedAt?: string;
  readonly createdByMembershipId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransactionPropertyLink {
  readonly id: string;
  readonly workspaceId: string;
  readonly propertyId: string;
  readonly transactionId: string;
  readonly role: 'subject' | 'comparable' | 'other';
  readonly createdByMembershipId: string;
  readonly createdAt: string;
}

export interface CreateManualPropertyInput {
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly stateCode: string;
  readonly postalCode: string;
  readonly kind: PropertyKind;
  readonly lifecycle: PropertyLifecycle;
  readonly idempotencyKey: string;
}

export interface UpsertPropertyFactInput {
  readonly propertyId: string;
  readonly field: PropertyFactField;
  readonly value: PropertyFactValue;
  readonly authority: PropertyFactAuthority;
  readonly provider?: string;
  readonly providerRecordId?: string;
  readonly sourceReference: string;
  readonly asOf: string;
  readonly permissionState: PropertyPermissionState;
  readonly displayUntil?: string;
  readonly retentionUntil?: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface UpdatePropertyIdentityInput extends Omit<CreateManualPropertyInput, 'idempotencyKey'> {
  readonly propertyId: string;
  readonly expectedVersion: number;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface LinkPropertyInterestInput {
  readonly propertyId: string;
  readonly contactId: string;
  readonly type: PropertyInterestType;
  readonly source: PropertyInterest['source'];
  readonly sourceReference: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

export interface ArchivePropertyInterestInput {
  readonly interestId: string;
  readonly expectedVersion: number;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface LinkTransactionPropertyInput {
  readonly propertyId: string;
  readonly transactionId: string;
  readonly role: TransactionPropertyLink['role'];
  readonly idempotencyKey: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{1,160}$/;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximum || CONTROL.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, label, maximum);
}

function instant(value: unknown, label: string): string {
  const normalized = text(value, label, 64);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function idempotencyKey(value: unknown): string {
  const normalized = text(value, 'Idempotency key', 160);
  if (!KEY.test(normalized)) throw new Error('Idempotency key is invalid.');
  return normalized;
}

export function normalizePropertyAddress(input: Pick<CreateManualPropertyInput, 'addressLine1' | 'addressLine2' | 'city' | 'stateCode' | 'postalCode'>): string {
  const pieces = [input.addressLine1, input.addressLine2, input.city, input.stateCode, input.postalCode]
    .filter(Boolean).map((value) => String(value).normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  return pieces.join('|');
}

export function validateCreateManualProperty(input: CreateManualPropertyInput): CreateManualPropertyInput & { readonly normalizedAddressKey: string } {
  if (!PROPERTY_KINDS.includes(input.kind)) throw new Error('Property type is invalid.');
  if (!PROPERTY_LIFECYCLES.includes(input.lifecycle)) throw new Error('Property lifecycle is invalid.');
  const addressLine1 = text(input.addressLine1, 'Street address', 160);
  const addressLine2 = optionalText(input.addressLine2, 'Address line 2', 80);
  const city = text(input.city, 'City', 100);
  const stateCode = text(input.stateCode, 'State', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateCode)) throw new Error('State is invalid.');
  const postalCode = text(input.postalCode, 'ZIP code', 10);
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) throw new Error('ZIP code is invalid.');
  const normalized = { ...input, addressLine1, ...(addressLine2 ? { addressLine2 } : {}), city, stateCode, postalCode, idempotencyKey: idempotencyKey(input.idempotencyKey) };
  return Object.freeze({ ...normalized, normalizedAddressKey: normalizePropertyAddress(normalized) });
}

export function validateUpdatePropertyIdentity(input: UpdatePropertyIdentityInput): UpdatePropertyIdentityInput & { readonly normalizedAddressKey: string } {
  if (!UUID.test(input.propertyId)) throw new Error('Choose a valid property.');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('Property version is invalid.');
  const created = validateCreateManualProperty(input);
  return Object.freeze({ ...created, propertyId: input.propertyId, expectedVersion: input.expectedVersion, reasonCode: text(input.reasonCode, 'Change reason', 80) });
}

function factValue(field: PropertyFactField, value: PropertyFactValue): PropertyFactValue {
  const integerFields: readonly PropertyFactField[] = ['bedrooms', 'square-feet', 'year-built', 'list-price-cents'];
  if (integerFields.includes(field)) {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000_000_000) throw new Error('Property fact value is invalid.');
    return Number(value);
  }
  if (field === 'bathrooms') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 || Math.round(value * 2) !== value * 2) throw new Error('Bathrooms must use whole or half values.');
    return value;
  }
  if (typeof value === 'boolean') return value;
  return text(value, 'Property fact value', 240);
}

export function validateUpsertPropertyFact(input: UpsertPropertyFactInput): UpsertPropertyFactInput {
  if (!UUID.test(input.propertyId)) throw new Error('Choose a valid property.');
  if (!PROPERTY_FACT_FIELDS.includes(input.field)) throw new Error('Property fact is invalid.');
  if (!PROPERTY_FACT_AUTHORITIES.includes(input.authority)) throw new Error('Property fact authority is invalid.');
  if (!PROPERTY_PERMISSION_STATES.includes(input.permissionState)) throw new Error('Property permission state is invalid.');
  const provider = optionalText(input.provider, 'Provider', 120);
  const providerRecordId = optionalText(input.providerRecordId, 'Provider record', 160);
  if (input.authority === 'licensed-provider' && (!provider || !providerRecordId || input.permissionState === 'unknown')) {
    throw new Error('Licensed facts require provider identity, record identity, and explicit permission.');
  }
  if (input.authority === 'manual' && (provider || providerRecordId)) throw new Error('Manual facts cannot claim provider authority.');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new Error('Property fact version is invalid.');
  const asOf = instant(input.asOf, 'Fact date');
  const displayUntil = input.displayUntil ? instant(input.displayUntil, 'Display limit') : undefined;
  const retentionUntil = input.retentionUntil ? instant(input.retentionUntil, 'Retention limit') : undefined;
  if (displayUntil && Date.parse(displayUntil) < Date.parse(asOf)) throw new Error('Display limit cannot precede the fact date.');
  if (retentionUntil && displayUntil && Date.parse(retentionUntil) < Date.parse(displayUntil)) throw new Error('Retention limit cannot precede the display limit.');
  return Object.freeze({
    ...input, value: factValue(input.field, input.value),
    ...(provider ? { provider } : {}), ...(providerRecordId ? { providerRecordId } : {}),
    sourceReference: text(input.sourceReference, 'Source reference', 240), asOf,
    ...(displayUntil ? { displayUntil } : {}), ...(retentionUntil ? { retentionUntil } : {}),
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  });
}

export function propertyFactCanDisplay(fact: PropertyFact, now = new Date()): boolean {
  if (fact.permissionState !== 'allowed') return false;
  return !fact.displayUntil || Date.parse(fact.displayUntil) >= now.getTime();
}

export function validateLinkPropertyInterest(input: LinkPropertyInterestInput): LinkPropertyInterestInput {
  if (!UUID.test(input.propertyId) || !UUID.test(input.contactId)) throw new Error('Choose a valid property and contact.');
  if (!PROPERTY_INTEREST_TYPES.includes(input.type)) throw new Error('Property interest type is invalid.');
  if (!['manual', 'website', 'licensed-provider'].includes(input.source)) throw new Error('Property interest source is invalid.');
  return Object.freeze({ ...input, sourceReference: text(input.sourceReference, 'Interest source', 240), occurredAt: instant(input.occurredAt, 'Interest time'), idempotencyKey: idempotencyKey(input.idempotencyKey) });
}

export function validateArchivePropertyInterest(input: ArchivePropertyInterestInput): ArchivePropertyInterestInput {
  if (!UUID.test(input.interestId)) throw new Error('Choose a valid property interest.');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('Property interest version is invalid.');
  return Object.freeze({ ...input, reasonCode: text(input.reasonCode, 'Archive reason', 80), idempotencyKey: idempotencyKey(input.idempotencyKey) });
}

export function validateLinkTransactionProperty(input: LinkTransactionPropertyInput): LinkTransactionPropertyInput {
  if (!UUID.test(input.propertyId) || !UUID.test(input.transactionId)) throw new Error('Choose a valid property and transaction.');
  if (!['subject', 'comparable', 'other'].includes(input.role)) throw new Error('Transaction property role is invalid.');
  return Object.freeze({ ...input, idempotencyKey: idempotencyKey(input.idempotencyKey) });
}
