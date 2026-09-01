export const LISTING_AUTHORITY_STATES = ['disabled', 'pending', 'active', 'suspended', 'revoked', 'expired'] as const;
export type ListingAuthorityState = (typeof LISTING_AUTHORITY_STATES)[number];
export const LISTING_CHANGE_KINDS = ['upsert', 'delete'] as const;
export type ListingChangeKind = (typeof LISTING_CHANGE_KINDS)[number];

export interface ListingDisplayPolicy {
  readonly attributionLabel: string;
  readonly attributionUrl: string;
  readonly freshnessMinutes: number;
  readonly displayHours: number;
  readonly retentionHours: number;
  readonly deletionDeadlineHours: number;
  readonly mediaPermitted: boolean;
}

export interface ListingProviderAuthority {
  readonly providerKey: string;
  readonly displayName: string;
  readonly state: ListingAuthorityState;
  readonly rightsReference: string;
  readonly credentialBindingReference?: string;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly policy: ListingDisplayPolicy;
}

export interface ListingSyncRequest {
  readonly cursor?: string;
  readonly pageSize: number;
  readonly requestedAt: string;
}

export interface LicensedListingChange {
  readonly kind: ListingChangeKind;
  readonly remoteRecordId: string;
  readonly modifiedAt: string;
  readonly payloadHash: string;
  readonly mappedFacts?: Readonly<Record<string, string | number | boolean>>;
}

export interface ListingSyncPage {
  readonly changes: readonly LicensedListingChange[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly providerAsOf: string;
}

export interface LicensedListingAdapter {
  readonly providerKey: string;
  readonly enabled: boolean;
  listChanges(request: ListingSyncRequest): Promise<ListingSyncPage>;
}

const KEY = /^[a-z][a-z0-9-]{2,79}$/u;
const REFERENCE = /^[A-Za-z0-9._:/-]{8,240}$/u;
const HASH = /^[a-f0-9]{64}$/u;

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > maximum || /[\p{Cc}\p{Cf}]/u.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function instant(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 64);
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function positiveInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} is invalid.`);
  return Number(value);
}

export function validateListingProviderAuthority(input: ListingProviderAuthority): ListingProviderAuthority {
  const providerKey = boundedText(input.providerKey, 'Provider key', 80).toLowerCase();
  if (!KEY.test(providerKey)) throw new Error('Provider key is invalid.');
  const state = input.state;
  if (!LISTING_AUTHORITY_STATES.includes(state)) throw new Error('Provider state is invalid.');
  const rightsReference = boundedText(input.rightsReference, 'Rights reference', 240);
  if (!REFERENCE.test(rightsReference)) throw new Error('Rights reference is invalid.');
  const credentialBindingReference = input.credentialBindingReference ? boundedText(input.credentialBindingReference, 'Credential binding', 240) : undefined;
  if (state === 'active' && !credentialBindingReference) throw new Error('Active listing access requires a server credential binding.');
  const effectiveAt = instant(input.effectiveAt, 'Effective date');
  const expiresAt = input.expiresAt ? instant(input.expiresAt, 'Expiry date') : undefined;
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(effectiveAt)) throw new Error('Expiry must follow the effective date.');
  const attributionUrl = new URL(input.policy.attributionUrl);
  if (attributionUrl.protocol !== 'https:') throw new Error('Provider attribution must use HTTPS.');
  const policy = Object.freeze({
    attributionLabel: boundedText(input.policy.attributionLabel, 'Attribution label', 120),
    attributionUrl: attributionUrl.toString(),
    freshnessMinutes: positiveInteger(input.policy.freshnessMinutes, 1, 43_200, 'Freshness policy'),
    displayHours: positiveInteger(input.policy.displayHours, 1, 8_760, 'Display policy'),
    retentionHours: positiveInteger(input.policy.retentionHours, 1, 87_600, 'Retention policy'),
    deletionDeadlineHours: positiveInteger(input.policy.deletionDeadlineHours, 1, 720, 'Deletion policy'),
    mediaPermitted: input.policy.mediaPermitted === true,
  });
  if (policy.retentionHours < policy.displayHours) throw new Error('Retention cannot end before display permission.');
  return Object.freeze({ ...input, providerKey, displayName: boundedText(input.displayName, 'Provider name', 120), rightsReference, ...(credentialBindingReference ? { credentialBindingReference } : {}), effectiveAt, ...(expiresAt ? { expiresAt } : {}), policy });
}

export function validateListingSyncRequest(input: ListingSyncRequest): ListingSyncRequest {
  const cursor = input.cursor ? boundedText(input.cursor, 'Provider cursor', 512) : undefined;
  return Object.freeze({ ...(cursor ? { cursor } : {}), pageSize: positiveInteger(input.pageSize, 1, 500, 'Page size'), requestedAt: instant(input.requestedAt, 'Request time') });
}

export function validateListingSyncPage(input: ListingSyncPage): ListingSyncPage {
  if (!Array.isArray(input.changes) || input.changes.length > 500) throw new Error('Provider change page is invalid.');
  const changes = input.changes.map((change) => {
    if (!LISTING_CHANGE_KINDS.includes(change.kind)) throw new Error('Provider change kind is invalid.');
    const remoteRecordId = boundedText(change.remoteRecordId, 'Remote listing identity', 160);
    if (!HASH.test(change.payloadHash)) throw new Error('Provider payload hash is invalid.');
    if (change.kind === 'upsert' && (!change.mappedFacts || Object.keys(change.mappedFacts).length === 0)) throw new Error('Upsert changes require mapped facts.');
    if (change.kind === 'delete' && change.mappedFacts) throw new Error('Deletion notices cannot include listing facts.');
    return Object.freeze({ ...change, remoteRecordId, modifiedAt: instant(change.modifiedAt, 'Provider modification time') });
  });
  const nextCursor = input.nextCursor ? boundedText(input.nextCursor, 'Next cursor', 512) : undefined;
  if (input.hasMore && !nextCursor) throw new Error('A continuing provider page requires a cursor.');
  return Object.freeze({ changes, ...(nextCursor ? { nextCursor } : {}), hasMore: input.hasMore === true, providerAsOf: instant(input.providerAsOf, 'Provider as-of time') });
}

export function createDisabledListingAdapter(providerKey = 'licensed-listing'): LicensedListingAdapter {
  const checked = validateListingProviderAuthority({ providerKey, displayName:'Disabled licensed listing adapter',state:'disabled',rightsReference:'disabled:no-rights-recorded',effectiveAt:'1970-01-01T00:00:00.000Z',policy:{attributionLabel:'Licensed listing provider',attributionUrl:'https://example.invalid/',freshnessMinutes:60,displayHours:24,retentionHours:24,deletionDeadlineHours:24,mediaPermitted:false} });
  return Object.freeze({ providerKey: checked.providerKey, enabled: false, async listChanges() { throw new Error('Licensed listing data is disabled until provider rights and server credentials are recorded.'); } });
}
