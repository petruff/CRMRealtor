import { describe, expect, it } from 'vitest';
import { normalizePropertyAddress, propertyFactCanDisplay, validateCreateManualProperty, validateLinkPropertyInterest, validateUpsertPropertyFact, type PropertyFact } from './property';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

describe('property bounded context', () => {
  it('normalizes address identity without turning it into contact or transaction identity', () => {
    const input = validateCreateManualProperty({ addressLine1: ' 123 Main St. ', city: ' Palm Beach ', stateCode: 'fl', postalCode: '33480', kind: 'condo', lifecycle: 'off-market', idempotencyKey: 'property:create:1' });
    expect(input.normalizedAddressKey).toBe('123 main st|palm beach|fl|33480');
    expect(normalizePropertyAddress(input)).toBe(input.normalizedAddressKey);
  });

  it('requires explicit provider identity and permission for licensed facts', () => {
    expect(() => validateUpsertPropertyFact({ propertyId: PROPERTY_ID, field: 'list-price-cents', value: 45000000, authority: 'licensed-provider', sourceReference: 'Feed row', asOf: '2026-08-31T12:00:00Z', permissionState: 'unknown', expectedVersion: 0, idempotencyKey: 'fact:1' })).toThrow(/provider identity/i);
    const fact = validateUpsertPropertyFact({ propertyId: PROPERTY_ID, field: 'list-price-cents', value: 45000000, authority: 'licensed-provider', provider: 'Licensed MLS adapter', providerRecordId: 'listing-1', sourceReference: 'Feed row', asOf: '2026-08-31T12:00:00Z', permissionState: 'allowed', displayUntil: '2026-09-01T12:00:00Z', expectedVersion: 0, idempotencyKey: 'fact:2' });
    expect(fact).toMatchObject({ authority: 'licensed-provider', permissionState: 'allowed' });
  });

  it('fails display closed for restricted, revoked, unknown, and expired facts', () => {
    const base: PropertyFact = { id: 'fact-1', workspaceId: 'workspace-1', propertyId: PROPERTY_ID, field: 'flood-zone', value: 'AE', authority: 'licensed-provider', provider: 'Provider', providerRecordId: 'record-1', sourceReference: 'Provider', asOf: '2026-08-30T12:00:00.000Z', permissionState: 'allowed', displayUntil: '2026-09-01T12:00:00.000Z', version: 1, recordedByMembershipId: 'membership-1', createdAt: '2026-08-30T12:00:00.000Z', updatedAt: '2026-08-30T12:00:00.000Z' };
    expect(propertyFactCanDisplay(base, new Date('2026-08-31T12:00:00Z'))).toBe(true);
    expect(propertyFactCanDisplay({ ...base, permissionState: 'revoked' }, new Date('2026-08-31T12:00:00Z'))).toBe(false);
    expect(propertyFactCanDisplay(base, new Date('2026-09-02T12:00:00Z'))).toBe(false);
  });

  it('validates sourced contact interest independently from property state', () => {
    expect(validateLinkPropertyInterest({ propertyId: PROPERTY_ID, contactId: CONTACT_ID, type: 'showing-intent', source: 'website', sourceReference: 'Signed website intake event', occurredAt: '2026-08-31T12:00:00Z', idempotencyKey: 'interest:1' })).toMatchObject({ type: 'showing-intent', source: 'website' });
  });
});
