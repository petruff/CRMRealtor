import {
  validateArchivePropertyInterest,
  validateCreateManualProperty,
  validateLinkPropertyInterest,
  validateLinkTransactionProperty,
  validateUpdatePropertyIdentity,
  validateUpsertPropertyFact,
  type PropertyFact,
  type PropertyIdentity,
  type PropertyInterest,
  type TransactionPropertyLink,
} from '@/lib/domain/property';
import { validateWorkspaceScope } from '@/lib/domain/workspace';
import type { PropertyRepository } from './property-repository';

interface Options {
  readonly contactExists?: (id: string) => Promise<boolean>;
  readonly transactionExists?: (id: string) => Promise<boolean>;
}

const cloneIdentity = (value: PropertyIdentity): PropertyIdentity => Object.freeze({ ...value });
const cloneFact = (value: PropertyFact): PropertyFact => Object.freeze({ ...value });
const cloneInterest = (value: PropertyInterest): PropertyInterest => Object.freeze({ ...value });

export function createMemoryPropertyRepository(options: Options = {}): PropertyRepository {
  const identities = new Map<string, PropertyIdentity>();
  const facts = new Map<string, PropertyFact>();
  const interests = new Map<string, PropertyInterest>();
  const links = new Map<string, TransactionPropertyLink>();
  const replays = new Map<string, { type: string; id: string }>();
  let identityCounter = 0;
  let factCounter = 0;
  let interestCounter = 0;
  let linkCounter = 0;

  const replayKey = (workspaceId: string, key: string) => `${workspaceId}:${key}`;
  const propertyFor = (workspaceId: string, id: string) => {
    const property = identities.get(id);
    if (!property || property.workspaceId !== workspaceId) throw new Error('Property was not found.');
    return property;
  };

  return {
    async list(untrustedScope, optionsValue = {}) {
      const scope = validateWorkspaceScope(untrustedScope);
      const limit = optionsValue.limit ?? 500;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Property list limit is invalid.');
      return [...identities.values()].filter((item) => item.workspaceId === scope.workspaceId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
        .slice(0, limit).map(cloneIdentity);
    },
    async listFacts(untrustedScope, propertyIds) {
      const scope = validateWorkspaceScope(untrustedScope);
      const requested = propertyIds ? new Set(propertyIds) : undefined;
      return [...facts.values()].filter((item) => item.workspaceId === scope.workspaceId && (!requested || requested.has(item.propertyId)))
        .sort((left, right) => left.field.localeCompare(right.field) || right.updatedAt.localeCompare(left.updatedAt)).map(cloneFact);
    },
    async listInterests(untrustedScope, query = {}) {
      const scope = validateWorkspaceScope(untrustedScope);
      return [...interests.values()].filter((item) => item.workspaceId === scope.workspaceId
        && (!query.propertyId || item.propertyId === query.propertyId)
        && (!query.contactId || item.contactId === query.contactId)
        && (query.includeArchived || !item.archivedAt))
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id)).map(cloneInterest);
    },
    async listTransactionLinks(untrustedScope, propertyIds) {
      const scope = validateWorkspaceScope(untrustedScope);
      const requested = propertyIds ? new Set(propertyIds) : undefined;
      return [...links.values()].filter((item) => item.workspaceId === scope.workspaceId && (!requested || requested.has(item.propertyId)))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)).map((item) => Object.freeze({ ...item }));
    },
    async createManual(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateCreateManualProperty(untrustedInput);
      const key = replayKey(scope.workspaceId, input.idempotencyKey);
      const replay = replays.get(key);
      if (replay) return cloneIdentity(propertyFor(scope.workspaceId, replay.id));
      const duplicate = [...identities.values()].find((item) => item.workspaceId === scope.workspaceId && item.normalizedAddressKey === input.normalizedAddressKey);
      if (duplicate) throw new Error('This property address already exists in the workspace.');
      identityCounter += 1;
      const item: PropertyIdentity = Object.freeze({
        id: `10000000-0000-4000-8000-${String(identityCounter).padStart(12, '0')}`, workspaceId: scope.workspaceId,
        addressLine1: input.addressLine1, ...(input.addressLine2 ? { addressLine2: input.addressLine2 } : {}), city: input.city,
        stateCode: input.stateCode, postalCode: input.postalCode, countryCode: 'US', normalizedAddressKey: input.normalizedAddressKey,
        kind: input.kind, lifecycle: input.lifecycle, version: 1, createdByMembershipId: scope.membershipId,
        updatedByMembershipId: scope.membershipId, createdAt: new Date(occurredAt).toISOString(), updatedAt: new Date(occurredAt).toISOString(),
      });
      identities.set(item.id, item); replays.set(key, { type: 'property', id: item.id });
      return cloneIdentity(item);
    },
    async updateIdentity(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateUpdatePropertyIdentity(untrustedInput);
      const key = replayKey(scope.workspaceId, input.idempotencyKey);
      const replay = replays.get(key);
      if (replay) return cloneIdentity(propertyFor(scope.workspaceId, replay.id));
      const current = propertyFor(scope.workspaceId, input.propertyId);
      if (current.version !== input.expectedVersion) throw new Error('This property changed after it was opened. Refresh and try again.');
      const duplicate = [...identities.values()].find((item) => item.workspaceId === scope.workspaceId && item.id !== current.id && item.normalizedAddressKey === input.normalizedAddressKey);
      if (duplicate) throw new Error('This property address already exists in the workspace.');
      const updated: PropertyIdentity = Object.freeze({ ...current, addressLine1: input.addressLine1,
        ...(input.addressLine2 ? { addressLine2: input.addressLine2 } : { addressLine2: undefined }), city: input.city,
        stateCode: input.stateCode, postalCode: input.postalCode, normalizedAddressKey: input.normalizedAddressKey,
        kind: input.kind, lifecycle: input.lifecycle, version: current.version + 1, updatedByMembershipId: scope.membershipId,
        updatedAt: new Date(occurredAt).toISOString() });
      identities.set(updated.id, updated); replays.set(key, { type: 'property', id: updated.id });
      return cloneIdentity(updated);
    },
    async upsertFact(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope);
      const input = validateUpsertPropertyFact(untrustedInput);
      propertyFor(scope.workspaceId, input.propertyId);
      const key = replayKey(scope.workspaceId, input.idempotencyKey);
      const replay = replays.get(key);
      if (replay) return cloneFact(facts.get(replay.id)!);
      const current = [...facts.values()].find((item) => item.workspaceId === scope.workspaceId && item.propertyId === input.propertyId
        && item.field === input.field && item.authority === input.authority && (item.provider ?? '') === (input.provider ?? ''));
      if ((current?.version ?? 0) !== input.expectedVersion) throw new Error('This property fact changed after it was opened. Refresh and try again.');
      factCounter += current ? 0 : 1;
      const timestamp = new Date(occurredAt).toISOString();
      const item: PropertyFact = Object.freeze({
        id: current?.id ?? `20000000-0000-4000-8000-${String(factCounter).padStart(12, '0')}`, workspaceId: scope.workspaceId,
        propertyId: input.propertyId, field: input.field, value: input.value, authority: input.authority,
        ...(input.provider ? { provider: input.provider } : {}), ...(input.providerRecordId ? { providerRecordId: input.providerRecordId } : {}),
        sourceReference: input.sourceReference, asOf: input.asOf, permissionState: input.permissionState,
        ...(input.displayUntil ? { displayUntil: input.displayUntil } : {}), ...(input.retentionUntil ? { retentionUntil: input.retentionUntil } : {}),
        version: (current?.version ?? 0) + 1, recordedByMembershipId: scope.membershipId,
        createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
      });
      facts.set(item.id, item); replays.set(key, { type: 'fact', id: item.id });
      return cloneFact(item);
    },
    async linkInterest(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const input = validateLinkPropertyInterest(untrustedInput);
      propertyFor(scope.workspaceId, input.propertyId);
      if (options.contactExists && !(await options.contactExists(input.contactId))) throw new Error('Contact was not found.');
      const key = replayKey(scope.workspaceId, input.idempotencyKey); const replay = replays.get(key);
      if (replay) return cloneInterest(interests.get(replay.id)!);
      interestCounter += 1; const timestamp = new Date(occurredAt).toISOString();
      const item: PropertyInterest = Object.freeze({ id: `30000000-0000-4000-8000-${String(interestCounter).padStart(12, '0')}`,
        workspaceId: scope.workspaceId, propertyId: input.propertyId, contactId: input.contactId, type: input.type, source: input.source,
        sourceReference: input.sourceReference, occurredAt: input.occurredAt, version: 1, createdByMembershipId: scope.membershipId,
        createdAt: timestamp, updatedAt: timestamp });
      interests.set(item.id, item); replays.set(key, { type: 'interest', id: item.id }); return cloneInterest(item);
    },
    async archiveInterest(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const input = validateArchivePropertyInterest(untrustedInput);
      const key = replayKey(scope.workspaceId, input.idempotencyKey); const replay = replays.get(key);
      if (replay) return cloneInterest(interests.get(replay.id)!);
      const current = interests.get(input.interestId);
      if (!current || current.workspaceId !== scope.workspaceId) throw new Error('Property interest was not found.');
      if (current.version !== input.expectedVersion) throw new Error('This property interest changed after it was opened. Refresh and try again.');
      const updated: PropertyInterest = Object.freeze({ ...current, version: current.version + 1, archivedAt: new Date(occurredAt).toISOString(), updatedAt: new Date(occurredAt).toISOString() });
      interests.set(updated.id, updated); replays.set(key, { type: 'interest', id: updated.id }); return cloneInterest(updated);
    },
    async linkTransaction(untrustedScope, untrustedInput, occurredAt) {
      const scope = validateWorkspaceScope(untrustedScope); const input = validateLinkTransactionProperty(untrustedInput);
      propertyFor(scope.workspaceId, input.propertyId);
      if (options.transactionExists && !(await options.transactionExists(input.transactionId))) throw new Error('Transaction was not found.');
      const key = replayKey(scope.workspaceId, input.idempotencyKey); const replay = replays.get(key);
      if (replay) return Object.freeze({ ...links.get(replay.id)! });
      const existing = [...links.values()].find((item) => item.workspaceId === scope.workspaceId && item.propertyId === input.propertyId && item.transactionId === input.transactionId && item.role === input.role);
      if (existing) { replays.set(key, { type: 'link', id: existing.id }); return Object.freeze({ ...existing }); }
      linkCounter += 1; const item: TransactionPropertyLink = Object.freeze({ id: `40000000-0000-4000-8000-${String(linkCounter).padStart(12, '0')}`,
        workspaceId: scope.workspaceId, propertyId: input.propertyId, transactionId: input.transactionId, role: input.role,
        createdByMembershipId: scope.membershipId, createdAt: new Date(occurredAt).toISOString() });
      links.set(item.id, item); replays.set(key, { type: 'link', id: item.id }); return Object.freeze({ ...item });
    },
  };
}
