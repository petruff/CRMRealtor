import type { Contact } from '../domain/contact.ts';
import {
  archiveIncompleteRecord,
  hasSafeIdentity,
  IncompleteRecordError,
  markIncompleteRecordConverted,
  restoreIncompleteRecord,
  type IncompleteCandidate,
  type IncompleteContactConversionPlan,
  type IncompleteRecord,
} from '../domain/incomplete-record.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { IncompleteRecordRepository } from './incomplete-record-repository.ts';

export interface MemoryIncompleteContact extends Contact {
  readonly workspaceId: string;
  readonly externalIds?: Readonly<Record<string, string>>;
}

export interface MemoryIncompleteRecordRepositoryOptions {
  readonly initialRecords?: readonly IncompleteRecord[];
  readonly initialContacts?: readonly MemoryIncompleteContact[];
  readonly idPrefix?: string;
  readonly contactIdPrefix?: string;
}

function normalizeEmail(value?: string): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function normalizePhone(value?: string): string | undefined {
  return value?.replace(/\D/g, '') || undefined;
}

function cloneRecord(record: IncompleteRecord): IncompleteRecord {
  return {
    ...record,
    candidate: { ...record.candidate, ...(record.candidate.tags ? { tags: [...record.candidate.tags] } : {}) },
    reasons: record.reasons.map((reason) => ({ ...reason })),
  };
}

function cloneContact(contact: MemoryIncompleteContact): MemoryIncompleteContact {
  return {
    ...contact,
    tags: [...contact.tags],
    ...(contact.buyer ? { buyer: { ...contact.buyer, areas: contact.buyer.areas ? [...contact.buyer.areas] : undefined } } : {}),
    ...(contact.seller ? { seller: { ...contact.seller } } : {}),
    ...(contact.externalIds ? { externalIds: { ...contact.externalIds } } : {}),
  };
}

function createInput(candidate: IncompleteCandidate): Omit<Contact, 'id' | 'createdAt'> {
  if (!candidate.firstName && !candidate.lastName) {
    throw new IncompleteRecordError(
      'invalid-input',
      'Correct the candidate to include a first or last name before conversion.',
      { firstName: 'Enter a first or last name.', lastName: 'Enter a first or last name.' },
    );
  }
  return {
    firstName: candidate.firstName ?? '',
    lastName: candidate.lastName ?? '',
    ...(candidate.preferredName ? { preferredName: candidate.preferredName } : {}),
    ...(candidate.phone ? { phone: candidate.phone } : {}),
    ...(candidate.secondaryPhone ? { secondaryPhone: candidate.secondaryPhone } : {}),
    ...(candidate.email ? { email: candidate.email } : {}),
    ...(candidate.mailingAddress ? { mailingAddress: candidate.mailingAddress } : {}),
    ...(candidate.city ? { city: candidate.city } : {}),
    ...(candidate.state ? { state: candidate.state } : {}),
    ...(candidate.postalCode ? { postalCode: candidate.postalCode } : {}),
    ...(candidate.birthdate ? { birthdate: candidate.birthdate } : {}),
    ...(candidate.homePurchaseDate ? { homePurchaseDate: candidate.homePurchaseDate } : {}),
    leadType: candidate.leadType ?? 'warm',
    relationship: candidate.relationship ?? 'lead',
    intent: candidate.intent ?? 'unknown',
    source: candidate.source ?? 'other',
    pipelineStage: candidate.pipelineStage ?? 'new',
    tags: [...(candidate.tags ?? [])],
    emailSubscribed: candidate.emailSubscribed ?? true,
    touchDateOverridden: false,
  };
}

function patchFor(contact: Contact, candidate: IncompleteCandidate): Partial<Contact> {
  const { tags, ...fields } = candidate;
  const input: Partial<Contact> = {
    ...fields,
    ...(tags ? { tags: [...tags] } : {}),
  };
  const patch: Partial<Contact> = {};
  for (const [key, value] of Object.entries(input)) {
    const current = contact[key as keyof Contact];
    if (value !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

function conversionFingerprint(recordId: string, candidate: IncompleteCandidate, plan: IncompleteContactConversionPlan): string {
  return JSON.stringify({ recordId, candidate, plan });
}

export function createMemoryIncompleteRecordRepository(
  options: MemoryIncompleteRecordRepositoryOptions = {},
): IncompleteRecordRepository {
  const records = (options.initialRecords ?? []).map(cloneRecord);
  const contacts = (options.initialContacts ?? []).map(cloneContact);
  const intakeFingerprints = new Map<string, string>();
  const conversionFingerprints = new Map<string, string>();
  let recordSequence = records.length + 1;
  let contactSequence = contacts.length + 1;
  const idPrefix = options.idPrefix ?? 'incomplete';
  const contactIdPrefix = options.contactIdPrefix ?? 'contact';

  function scope(value: WorkspaceScope): WorkspaceScope {
    return validateWorkspaceScope(value);
  }

  function recordIndex(workspaceScope: WorkspaceScope, id: string): number {
    const authorized = scope(workspaceScope);
    return records.findIndex((record) => record.id === id && record.workspaceId === authorized.workspaceId);
  }

  function requiredRecord(workspaceScope: WorkspaceScope, id: string) {
    const index = recordIndex(workspaceScope, id);
    const record = records[index];
    if (index < 0 || !record) throw new IncompleteRecordError('not-found', 'Incomplete record not found.');
    return { index, record };
  }

  function ensureActor(workspaceScope: WorkspaceScope, actorMembershipId: string): WorkspaceScope {
    const authorized = scope(workspaceScope);
    if (actorMembershipId !== authorized.membershipId) {
      throw new IncompleteRecordError('forbidden', 'Actor does not match authenticated workspace membership.');
    }
    return authorized;
  }

  return {
    async list(workspaceScope, query) {
      const authorized = scope(workspaceScope);
      const needle = query.query?.trim().toLowerCase();
      return records
        .filter((record) => record.workspaceId === authorized.workspaceId)
        .filter((record) => query.status === 'all' || !query.status || record.status === query.status)
        .filter((record) => {
          if (!needle) return true;
          return [record.id, record.source, record.externalId, record.candidate.firstName, record.candidate.lastName]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(needle));
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
        .slice(0, query.limit)
        .map(cloneRecord);
    },

    async get(workspaceScope, id) {
      const index = recordIndex(workspaceScope, id);
      const record = records[index];
      return record ? cloneRecord(record) : undefined;
    },

    async create(workspaceScope, input) {
      const authorized = scope(workspaceScope);
      if (!hasSafeIdentity(input.candidate, input.externalId)) {
        throw new IncompleteRecordError('invalid-input', 'Candidate has no safe identity signal.');
      }
      const fingerprint = JSON.stringify({
        source: input.source,
        externalId: input.externalId,
        candidate: input.candidate,
        reasons: input.reasons,
      });
      if (input.intakeIdempotencyKey) {
        const key = `${authorized.workspaceId}:${input.intakeIdempotencyKey}`;
        const existingFingerprint = intakeFingerprints.get(key);
        if (existingFingerprint && existingFingerprint !== fingerprint) {
          throw new IncompleteRecordError('conflict', 'Intake idempotency key was reused with different data.');
        }
        const existing = records.find((record) => (
          record.workspaceId === authorized.workspaceId
          && record.intakeIdempotencyKey === input.intakeIdempotencyKey
        ));
        if (existing) return cloneRecord(existing);
        intakeFingerprints.set(key, fingerprint);
      }
      const created: IncompleteRecord = {
        id: `${idPrefix}-${String(recordSequence++).padStart(4, '0')}`,
        workspaceId: authorized.workspaceId,
        source: input.source,
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...(input.intakeIdempotencyKey ? { intakeIdempotencyKey: input.intakeIdempotencyKey } : {}),
        candidate: { ...input.candidate },
        reasons: input.reasons.map((reason) => ({ ...reason })),
        status: 'pending',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      records.push(created);
      return cloneRecord(created);
    },

    async previewConversion(workspaceScope, input) {
      const authorized = scope(workspaceScope);
      const { record } = requiredRecord(workspaceScope, input.recordId);
      if (record.status === 'archived') {
        throw new IncompleteRecordError('conflict', 'Archived records must be restored before conversion.');
      }
      const external = record.externalId
        ? contacts.find((contact) => (
          contact.workspaceId === authorized.workspaceId
          && contact.externalIds?.[record.source] === record.externalId
        ))
        : undefined;
      const email = normalizeEmail(input.candidate.email);
      const phone = normalizePhone(input.candidate.phone);
      const matched = external
        ?? (email ? contacts.find((contact) => (
          contact.workspaceId === authorized.workspaceId && normalizeEmail(contact.email) === email
        )) : undefined)
        ?? (phone ? contacts.find((contact) => (
          contact.workspaceId === authorized.workspaceId && normalizePhone(contact.phone) === phone
        )) : undefined);
      if (!matched) {
        return {
          action: 'create',
          contactInput: createInput(input.candidate),
          changes: Object.keys(createInput(input.candidate)),
        };
      }
      const patch = patchFor(matched, input.candidate);
      const changes = Object.keys(patch);
      return {
        action: changes.length ? 'update' : 'unchanged',
        matchedContactId: matched.id,
        matchedBy: external ? 'external-id' : email ? 'email' : 'phone',
        ...(changes.length ? { contactPatch: patch } : {}),
        changes,
      };
    },

    async convertAtomically(workspaceScope, input) {
      const authorized = ensureActor(workspaceScope, input.actorMembershipId);
      const current = requiredRecord(workspaceScope, input.recordId);
      if (current.record.status === 'converted') {
        return markIncompleteRecordConverted(current.record, {
          contactId: current.record.convertedContactId ?? input.plan.matchedContactId ?? 'invalid',
          action: current.record.conversionAction ?? input.plan.action,
          idempotencyKey: input.idempotencyKey,
          actorMembershipId: input.actorMembershipId,
          convertedAt: input.convertedAt,
        });
      }
      const fingerprint = conversionFingerprint(input.recordId, input.candidate, input.plan);
      const replayKey = `${authorized.workspaceId}:${input.idempotencyKey}`;
      const existingFingerprint = conversionFingerprints.get(replayKey);
      if (existingFingerprint && existingFingerprint !== fingerprint) {
        throw new IncompleteRecordError('conflict', 'Conversion idempotency key was reused with different data.');
      }

      let contactId = input.plan.matchedContactId;
      let nextContact: MemoryIncompleteContact | undefined;
      let contactIndex = -1;
      if (input.plan.action === 'create') {
        if (!input.plan.contactInput || contactId) {
          throw new IncompleteRecordError('invalid-input', 'Create conversion plan is invalid.');
        }
        contactId = `${contactIdPrefix}-${String(contactSequence).padStart(4, '0')}`;
        nextContact = {
          ...input.plan.contactInput,
          id: contactId,
          workspaceId: authorized.workspaceId,
          createdAt: input.convertedAt,
          ...(current.record.externalId ? {
            externalIds: { [current.record.source]: current.record.externalId },
          } : {}),
        };
      } else {
        contactIndex = contacts.findIndex((contact) => (
          contact.id === contactId && contact.workspaceId === authorized.workspaceId
        ));
        const existing = contacts[contactIndex];
        if (!existing || !contactId) {
          throw new IncompleteRecordError('conflict', 'Matched contact is unavailable in this workspace.');
        }
        if (input.plan.action === 'update') {
          if (!input.plan.contactPatch) {
            throw new IncompleteRecordError('invalid-input', 'Update conversion plan is missing its patch.');
          }
          nextContact = { ...existing, ...input.plan.contactPatch, id: existing.id, workspaceId: existing.workspaceId };
        }
      }

      if (!contactId) throw new IncompleteRecordError('conflict', 'Conversion did not resolve a contact.');
      const receipt = markIncompleteRecordConverted(current.record, {
        contactId,
        action: input.plan.action,
        idempotencyKey: input.idempotencyKey,
        actorMembershipId: input.actorMembershipId,
        convertedAt: input.convertedAt,
      });

      if (input.plan.action === 'create' && nextContact) {
        contacts.push(nextContact);
        contactSequence += 1;
      } else if (input.plan.action === 'update' && nextContact) {
        contacts[contactIndex] = nextContact;
      }
      records[current.index] = receipt.record;
      conversionFingerprints.set(replayKey, fingerprint);
      return { ...receipt, record: cloneRecord(receipt.record) };
    },

    async archive(workspaceScope, id, input) {
      ensureActor(workspaceScope, input.actorMembershipId);
      const current = requiredRecord(workspaceScope, id);
      const result = archiveIncompleteRecord(
        current.record,
        input.actorMembershipId,
        input.archivedAt,
        input.reason,
      );
      records[current.index] = result.record;
      return { record: cloneRecord(result.record), noOp: result.noOp };
    },

    async restore(workspaceScope, id, restoredAt) {
      const current = requiredRecord(workspaceScope, id);
      const result = restoreIncompleteRecord(current.record, restoredAt);
      records[current.index] = result.record;
      return { record: cloneRecord(result.record), noOp: result.noOp };
    },
  };
}
