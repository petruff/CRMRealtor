'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import {
  PROPERTY_FACT_FIELDS,
  PROPERTY_INTEREST_TYPES,
  PROPERTY_KINDS,
  PROPERTY_LIFECYCLES,
  type PropertyFactField,
  type PropertyInterestType,
  type PropertyKind,
  type PropertyLifecycle,
} from '@/lib/domain/property';

const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const version = (data: FormData, key: string) => {
  const parsed = Number(value(data, key));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('The record version is invalid. Refresh and try again.');
  return parsed;
};

function propertyFactValue(field: PropertyFactField, raw: string): string | number {
  if (field === 'list-price-cents') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Enter a valid list price.');
    return Math.round(parsed * 100);
  }
  if (['bedrooms', 'square-feet', 'year-built'].includes(field)) {
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed)) throw new Error('Enter a whole number for this property fact.');
    return parsed;
  }
  if (field === 'bathrooms') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error('Enter a valid bathroom count.');
    return parsed;
  }
  return raw;
}

function refreshPropertySurfaces(): void {
  revalidatePath('/properties');
  revalidatePath('/transactions');
  revalidatePath('/contacts');
  revalidatePath('/');
}

export async function createManualPropertyAction(formData: FormData): Promise<void> {
  const kind = value(formData, 'kind') as PropertyKind;
  const lifecycle = value(formData, 'lifecycle') as PropertyLifecycle;
  if (!PROPERTY_KINDS.includes(kind) || !PROPERTY_LIFECYCLES.includes(lifecycle)) throw new Error('Choose a valid property type and lifecycle.');
  const context = await getRepository();
  await context.propertyRepository.createManual(context.workspaceScope, {
    addressLine1: value(formData, 'addressLine1'), addressLine2: value(formData, 'addressLine2') || undefined,
    city: value(formData, 'city'), stateCode: value(formData, 'stateCode'), postalCode: value(formData, 'postalCode'),
    kind, lifecycle, idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function updatePropertyIdentityAction(formData: FormData): Promise<void> {
  const kind = value(formData, 'kind') as PropertyKind;
  const lifecycle = value(formData, 'lifecycle') as PropertyLifecycle;
  if (!PROPERTY_KINDS.includes(kind) || !PROPERTY_LIFECYCLES.includes(lifecycle)) throw new Error('Choose a valid property type and lifecycle.');
  const context = await getRepository();
  await context.propertyRepository.updateIdentity(context.workspaceScope, {
    propertyId: value(formData, 'propertyId'), expectedVersion: version(formData, 'expectedVersion'),
    addressLine1: value(formData, 'addressLine1'), addressLine2: value(formData, 'addressLine2') || undefined,
    city: value(formData, 'city'), stateCode: value(formData, 'stateCode'), postalCode: value(formData, 'postalCode'),
    kind, lifecycle, reasonCode: value(formData, 'reasonCode'), idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function upsertManualPropertyFactAction(formData: FormData): Promise<void> {
  const field = value(formData, 'field') as PropertyFactField;
  if (!PROPERTY_FACT_FIELDS.includes(field)) throw new Error('Choose a valid property fact.');
  const context = await getRepository();
  const propertyId = value(formData, 'propertyId');
  const current = (await context.propertyRepository.listFacts(context.workspaceScope, [propertyId]))
    .find((fact) => fact.field === field && fact.authority === 'manual');
  await context.propertyRepository.upsertFact(context.workspaceScope, {
    propertyId, field, value: propertyFactValue(field, value(formData, 'factValue')),
    authority: 'manual', sourceReference: value(formData, 'sourceReference'),
    asOf: `${value(formData, 'asOf')}T12:00:00.000Z`, permissionState: 'allowed',
    expectedVersion: current?.version ?? 0, idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function linkPropertyInterestAction(formData: FormData): Promise<void> {
  const type = value(formData, 'type') as PropertyInterestType;
  if (!PROPERTY_INTEREST_TYPES.includes(type)) throw new Error('Choose a valid relationship to this property.');
  const context = await getRepository();
  await context.propertyRepository.linkInterest(context.workspaceScope, {
    propertyId: value(formData, 'propertyId'), contactId: value(formData, 'contactId'), type,
    source: 'manual', sourceReference: value(formData, 'sourceReference'),
    occurredAt: `${value(formData, 'occurredOn')}T12:00:00.000Z`, idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function archivePropertyInterestAction(formData: FormData): Promise<void> {
  const context = await getRepository();
  await context.propertyRepository.archiveInterest(context.workspaceScope, {
    interestId: value(formData, 'interestId'), expectedVersion: version(formData, 'expectedVersion'),
    reasonCode: value(formData, 'reasonCode'), idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function linkTransactionPropertyAction(formData: FormData): Promise<void> {
  const role = value(formData, 'role') as 'subject' | 'comparable' | 'other';
  if (!['subject', 'comparable', 'other'].includes(role)) throw new Error('Choose a valid deal relationship.');
  const context = await getRepository();
  await context.propertyRepository.linkTransaction(context.workspaceScope, {
    propertyId: value(formData, 'propertyId'), transactionId: value(formData, 'transactionId'), role,
    idempotencyKey: value(formData, 'idempotencyKey'),
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function recordListingProviderRightsAction(formData: FormData): Promise<void> {
  const context = await getRepository();
  if (context.workspaceScope.role !== 'owner') throw new Error('Only the workspace owner can record listing provider rights.');
  const number = (key: string) => {
    const parsed = Number(value(formData, key));
    if (!Number.isSafeInteger(parsed)) throw new Error('Provider policy values must be whole numbers.');
    return parsed;
  };
  await context.listingProviderRepository.configureAuthority(context.workspaceScope, {
    providerKey: value(formData, 'providerKey'), displayName: value(formData, 'displayName'), state: 'pending',
    rightsReference: value(formData, 'rightsReference'), effectiveAt: `${value(formData, 'effectiveOn')}T12:00:00.000Z`,
    expiresAt: value(formData, 'expiresOn') ? `${value(formData, 'expiresOn')}T12:00:00.000Z` : undefined,
    policy: { attributionLabel:value(formData,'attributionLabel'),attributionUrl:value(formData,'attributionUrl'),freshnessMinutes:number('freshnessMinutes'),displayHours:number('displayHours'),retentionHours:number('retentionHours'),deletionDeadlineHours:number('deletionDeadlineHours'),mediaPermitted:formData.get('mediaPermitted')==='on' },
  }, new Date().toISOString());
  refreshPropertySurfaces();
}

export async function revokeListingProviderRightsAction(formData: FormData): Promise<void> {
  const context = await getRepository();
  await context.listingProviderRepository.revokeAuthority(context.workspaceScope,value(formData,'authorityId'),value(formData,'reasonCode'),new Date().toISOString());
  refreshPropertySurfaces();
}

export async function recordPropertyBehaviorAction(formData: FormData): Promise<void> {
  const context = await getRepository();
  const type = value(formData,'behaviorType') as 'inquiry'|'view'|'saved'|'favorite'|'showing-request'|'seller-intake';
  await context.propertyBehaviorRepository.recordBehavior(context.workspaceScope,{propertyId:value(formData,'propertyId'),contactId:value(formData,'contactId'),type,source:'manual',sourceReference:value(formData,'sourceReference'),occurredAt:`${value(formData,'occurredOn')}T12:00:00.000Z`,permissionState:'allowed',idempotencyKey:value(formData,'idempotencyKey')},new Date().toISOString());
  refreshPropertySurfaces();
}

export async function createCmaRequestAction(formData: FormData): Promise<void> {
  const context = await getRepository();
  const integer=(key:string)=>{const parsed=Number(value(formData,key));if(!Number.isInteger(parsed))throw new Error('CMA criteria must use valid whole numbers.');return parsed;};
  await context.propertyBehaviorRepository.createCmaRequest(context.workspaceScope,{propertyId:value(formData,'propertyId'),contactId:value(formData,'contactId')||undefined,purpose:value(formData,'purpose') as 'seller-consultation'|'buyer-offer'|'listing-review',criteria:{radiusMiles:Number(value(formData,'radiusMiles')),lookbackDays:integer('lookbackDays'),propertyKinds:[value(formData,'propertyKind')],bedroomsTolerance:integer('bedroomsTolerance'),bathroomsTolerance:Number(value(formData,'bathroomsTolerance')),squareFeetTolerancePercent:Number(value(formData,'squareFeetTolerancePercent'))},asOf:new Date().toISOString(),providerAuthorityId:value(formData,'providerAuthorityId')||undefined,idempotencyKey:value(formData,'idempotencyKey')},new Date().toISOString());
  refreshPropertySurfaces();
}
