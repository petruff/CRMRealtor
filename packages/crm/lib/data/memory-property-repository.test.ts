import { describe, expect, it } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { createMemoryPropertyRepository } from './memory-property-repository';

const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const TRANSACTION_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-08-31T12:00:00.000Z';

describe('memory property repository', () => {
  it('persists identity, sourced facts, interests, and transaction links without cross-mutation', async () => {
    const repository = createMemoryPropertyRepository({ contactExists: async (id) => id === CONTACT_ID, transactionExists: async (id) => id === TRANSACTION_ID });
    const property = await repository.createManual(SAMPLE_WORKSPACE_SCOPE, { addressLine1: '123 Main Street', city: 'Palm Beach', stateCode: 'FL', postalCode: '33480', kind: 'condo', lifecycle: 'off-market', idempotencyKey: 'property:create:1' }, NOW);
    const replay = await repository.createManual(SAMPLE_WORKSPACE_SCOPE, { addressLine1: '123 Main Street', city: 'Palm Beach', stateCode: 'FL', postalCode: '33480', kind: 'condo', lifecycle: 'off-market', idempotencyKey: 'property:create:1' }, NOW);
    expect(replay.id).toBe(property.id);
    const fact = await repository.upsertFact(SAMPLE_WORKSPACE_SCOPE, { propertyId: property.id, field: 'flood-zone', value: 'AE', authority: 'manual', sourceReference: 'Owner-provided disclosure', asOf: NOW, permissionState: 'allowed', expectedVersion: 0, idempotencyKey: 'property:fact:1' }, NOW);
    const interest = await repository.linkInterest(SAMPLE_WORKSPACE_SCOPE, { propertyId: property.id, contactId: CONTACT_ID, type: 'showing-intent', source: 'manual', sourceReference: 'Phone conversation', occurredAt: NOW, idempotencyKey: 'property:interest:1' }, NOW);
    const link = await repository.linkTransaction(SAMPLE_WORKSPACE_SCOPE, { propertyId: property.id, transactionId: TRANSACTION_ID, role: 'subject', idempotencyKey: 'property:transaction:1' }, NOW);
    expect(await repository.listFacts(SAMPLE_WORKSPACE_SCOPE, [property.id])).toEqual([fact]);
    expect(await repository.listInterests(SAMPLE_WORKSPACE_SCOPE, { propertyId: property.id })).toEqual([interest]);
    expect(await repository.listTransactionLinks(SAMPLE_WORKSPACE_SCOPE, [property.id])).toEqual([link]);
    expect(await repository.listFacts(SAMPLE_WORKSPACE_SCOPE, [])).toEqual([]);
    expect(await repository.listTransactionLinks(SAMPLE_WORKSPACE_SCOPE, [])).toEqual([]);
    expect((await repository.list(SAMPLE_WORKSPACE_SCOPE))[0]).toMatchObject({ lifecycle: 'off-market', version: 1 });
  });

  it('rejects stale fact updates and duplicate addresses while retaining idempotent replay', async () => {
    const repository = createMemoryPropertyRepository();
    const property = await repository.createManual(SAMPLE_WORKSPACE_SCOPE, { addressLine1: '10 Ocean Drive', city: 'Miami Beach', stateCode: 'FL', postalCode: '33139', kind: 'condo', lifecycle: 'active', idempotencyKey: 'property:create:2' }, NOW);
    await repository.upsertFact(SAMPLE_WORKSPACE_SCOPE, { propertyId: property.id, field: 'bedrooms', value: 2, authority: 'manual', sourceReference: 'Realtor entry', asOf: NOW, permissionState: 'allowed', expectedVersion: 0, idempotencyKey: 'fact:create' }, NOW);
    await expect(repository.upsertFact(SAMPLE_WORKSPACE_SCOPE, { propertyId: property.id, field: 'bedrooms', value: 3, authority: 'manual', sourceReference: 'Realtor entry', asOf: NOW, permissionState: 'allowed', expectedVersion: 0, idempotencyKey: 'fact:stale' }, NOW)).rejects.toThrow(/changed/i);
    await expect(repository.createManual(SAMPLE_WORKSPACE_SCOPE, { addressLine1: '10 Ocean Drive', city: 'Miami Beach', stateCode: 'FL', postalCode: '33139', kind: 'condo', lifecycle: 'active', idempotencyKey: 'property:create:duplicate' }, NOW)).rejects.toThrow(/already exists/i);
  });
});
