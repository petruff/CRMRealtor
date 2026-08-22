/** Persistence seam for import identity links, atomic groups and intake receipts. */

import type { Contact } from '../domain/contact.ts';
import type { ActivityRepository } from './activity-repository.ts';
import type { ContactRepository } from './repository.ts';
import type { RichContactRepository } from './rich-contact-repository.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { normalizeContactEmail, normalizeContactPhone } from '../domain/rich-contact.ts';

export interface ContactExternalLink {
  provider: string;
  externalId: string;
  contactId: string;
}

export interface IntakeReceipt {
  idempotencyKey: string;
  requestHash: string;
  statusCode: number;
  response: unknown;
  createdAt: string;
}

export interface ContactImportIdentityResult {
  readonly outcome: 'none' | 'active-match' | 'archived-match' | 'ambiguous-identity';
  readonly contactId?: string;
  readonly matchedBy?: 'external-id' | 'email' | 'phone';
  readonly matchCount: number;
}

export interface ContactImportGroupPlan {
  readonly action: 'create' | 'update' | 'unchanged';
  readonly contactId?: string;
  readonly contact: Omit<Contact, 'id' | 'createdAt'> | (
    Omit<Partial<Contact>, 'nextTouchAt'> & { readonly nextTouchAt?: string | null }
  );
  readonly points: readonly {
    type: 'phone' | 'email'; label: string; displayValue: string; normalizedValue: string;
    isPrimary: boolean; emailSubscribed?: boolean; displayOrder: number;
  }[];
  readonly householdIds: readonly string[];
  readonly assigneeMembershipIds: readonly string[];
  readonly customValues: readonly { definitionId: string; value: string | number | boolean }[];
  readonly sourceProfile?: {
    readonly provider: string;
    readonly schemaVersion: string;
    readonly facts: readonly {
      readonly key: string;
      readonly label: string;
      readonly category: 'identity' | 'ownership' | 'address' | 'real-estate' | 'engagement' | 'verification' | 'consent' | 'other';
      readonly valueType: 'text' | 'number' | 'boolean' | 'date' | 'timestamp';
      readonly value: string | number | boolean;
      readonly sourceRowNumber?: number;
    }[];
  };
  readonly externalLink?: { provider: string; externalId: string };
  readonly note?: string;
  readonly activityIdempotencyKey: string;
}

export interface ContactImportGroupCommand {
  readonly scope: WorkspaceScope;
  readonly groupIdempotencyKey: string;
  readonly requestHash: string;
  readonly plan: ContactImportGroupPlan;
  readonly occurredAt: string;
  /** Used only by the memory adapter; live activity is inside the database RPC. */
  readonly activityRepository?: ActivityRepository;
}

export interface ContactImportGroupResult {
  readonly contactId: string;
  readonly action: 'create' | 'update' | 'unchanged';
  readonly notesAdded: boolean;
  readonly noOp: boolean;
}

export type ImportedContactOrganizationSnapshot = Readonly<{
  leadType: Contact['leadType'];
  qualificationStatus: Contact['qualificationStatus'];
  relationship: Contact['relationship'];
  intent: Contact['intent'];
  source: Contact['source'];
  pipelineStage: Contact['pipelineStage'];
  nextTouchAt: string | null;
  touchDateOverridden: boolean;
}>;

export interface ImportedContactOrganizationChange {
  readonly contactId: string;
  readonly expectedUpdatedAt: string;
  readonly after: ImportedContactOrganizationSnapshot;
}

export interface ImportedContactOrganizationReceipt {
  readonly runId: string;
  readonly contactCount: number;
  readonly state: 'applied' | 'rolled-back';
  readonly noOp: boolean;
  readonly rollbackAvailable?: boolean;
}

export interface ImportGateway {
  linksFor(provider: string, externalIds: string[]): Promise<ContactExternalLink[]>;
  linkContact(link: ContactExternalLink): Promise<void>;
  getReceipt(idempotencyKey: string): Promise<IntakeReceipt | undefined>;
  /** Atomically reserves a key; false means another request already owns it. */
  claimReceipt(receipt: IntakeReceipt): Promise<boolean>;
  completeReceipt(receipt: IntakeReceipt): Promise<void>;
  releaseReceipt(idempotencyKey: string, requestHash: string): Promise<void>;
  resolveContactImportIdentity?(input: {
    scope: WorkspaceScope; provider: string; externalId?: string; email?: string; phone?: string;
  }): Promise<ContactImportIdentityResult>;
  applyContactImportGroup(command: ContactImportGroupCommand): Promise<ContactImportGroupResult>;
  applyImportedContactOrganization?(command: {
    readonly scope: WorkspaceScope;
    readonly policyVersion: string;
    readonly requestHash: string;
    readonly changes: readonly ImportedContactOrganizationChange[];
    readonly occurredAt: string;
  }): Promise<ImportedContactOrganizationReceipt>;
  rollbackImportedContactOrganization?(command: {
    readonly scope: WorkspaceScope;
    readonly runId: string;
    readonly requestHash: string;
    readonly occurredAt: string;
  }): Promise<ImportedContactOrganizationReceipt>;
}

interface MemoryImportStore {
  links: ContactExternalLink[];
  receipts: IntakeReceipt[];
}

const CACHE_KEY = '__omnixMemoryImportStore__';

function memoryStore(): MemoryImportStore {
  const globalRef = globalThis as typeof globalThis & { [CACHE_KEY]?: MemoryImportStore };
  globalRef[CACHE_KEY] ??= { links: [], receipts: [] };
  return globalRef[CACHE_KEY];
}

export interface MemoryImportGatewayOptions {
  readonly repository?: ContactRepository;
  readonly richContactRepository?: RichContactRepository;
  readonly activityRepository?: ActivityRepository;
}

/** Demo/test gateway with an explicit rollback boundary for each target group. */
export function memoryImportGateway(options: MemoryImportGatewayOptions = {}): ImportGateway {
  async function saveLink(link: ContactExternalLink): Promise<void> {
    const state = memoryStore();
    const existing = state.links.find(
      (item) => item.provider === link.provider && item.externalId === link.externalId,
    );
    if (existing && existing.contactId !== link.contactId) {
      throw new Error(`External identity ${link.provider}/${link.externalId} is already linked.`);
    }
    if (!existing) state.links.push({ ...link });
  }
  return {
    async linksFor(provider, externalIds) {
      const wanted = new Set(externalIds);
      return memoryStore().links.filter((link) => link.provider === provider && wanted.has(link.externalId));
    },
    async linkContact(link) {
      await saveLink(link);
    },
    async getReceipt(idempotencyKey) {
      return memoryStore().receipts.find((receipt) => receipt.idempotencyKey === idempotencyKey);
    },
    async claimReceipt(receipt) {
      const state = memoryStore();
      if (state.receipts.some((item) => item.idempotencyKey === receipt.idempotencyKey)) return false;
      state.receipts.push({ ...receipt });
      return true;
    },
    async completeReceipt(receipt) {
      const state = memoryStore();
      const index = state.receipts.findIndex(
        (item) => item.idempotencyKey === receipt.idempotencyKey && item.requestHash === receipt.requestHash,
      );
      if (index < 0) throw new Error('Intake receipt reservation was lost.');
      state.receipts[index] = { ...receipt };
    },
    async releaseReceipt(idempotencyKey, requestHash) {
      const state = memoryStore();
      state.receipts = state.receipts.filter(
        (item) => item.idempotencyKey !== idempotencyKey || item.requestHash !== requestHash,
      );
    },
    async resolveContactImportIdentity(input) {
      const repository = options.repository;
      if (!repository) throw new Error('Import identity resolution requires a contact repository.');
      const contacts = await repository.list({ includeArchived: true });
      const contactIds = new Set<string>();
      let matchedBy: ContactImportIdentityResult['matchedBy'];
      const external = input.externalId
        ? memoryStore().links.find((link) => link.provider === input.provider && link.externalId === input.externalId)
        : undefined;
      if (external) {
        contactIds.add(external.contactId);
        matchedBy = 'external-id';
      }
      const points = options.richContactRepository
        ? (await Promise.all(contacts.map((contact) => (
            options.richContactRepository!.listContactPoints(input.scope, contact.id, false)
          )))).flat()
        : [];
      const normalizedEmail = input.email ? normalizeContactEmail(input.email).normalizedValue : undefined;
      const normalizedPhone = input.phone ? normalizeContactPhone(input.phone).normalizedValue : undefined;
      const emailContactIds = new Set(points.filter((point) => (
        point.type === 'email' && normalizedEmail && point.normalizedValue === normalizedEmail
      )).map((point) => point.contactId));
      const phoneContactIds = new Set(points.filter((point) => (
        point.type === 'phone' && normalizedPhone && point.normalizedValue === normalizedPhone
      )).map((point) => point.contactId));
      if (!options.richContactRepository) {
        for (const contact of contacts) {
          if (normalizedEmail && contact.email
            && normalizeContactEmail(contact.email).normalizedValue === normalizedEmail) emailContactIds.add(contact.id);
          if (normalizedPhone && contact.phone
            && normalizeContactPhone(contact.phone).normalizedValue === normalizedPhone) phoneContactIds.add(contact.id);
        }
      }
      for (const id of emailContactIds) contactIds.add(id);
      for (const id of phoneContactIds) contactIds.add(id);
      if (!matchedBy && emailContactIds.size) matchedBy = 'email';
      if (!matchedBy && phoneContactIds.size) matchedBy = 'phone';
      if (contactIds.size === 0) return { outcome: 'none', matchCount: 0 };
      if (contactIds.size > 1) return {
        outcome: 'ambiguous-identity',
        ...(matchedBy ? { matchedBy } : {}),
        matchCount: contactIds.size,
      };
      const contactId = [...contactIds][0]!;
      const contact = contacts.find((item) => item.id === contactId);
      return {
        outcome: contact?.archivedAt ? 'archived-match' : 'active-match',
        contactId,
        ...(matchedBy ? { matchedBy } : {}),
        matchCount: 1,
      };
    },
    async applyContactImportGroup(command) {
      const repository = options.repository;
      if (!repository?.runTransaction) {
        throw new Error('Atomic memory import requires a transactional contact repository.');
      }
      const activityRepository = options.activityRepository ?? command.activityRepository;
      if (activityRepository && !activityRepository.runTransaction) {
        throw new Error('Atomic memory import requires a transactional activity repository.');
      }
      if (options.richContactRepository && !options.richContactRepository.runTransaction) {
        throw new Error('Atomic memory import requires a transactional rich-contact repository.');
      }
      const state = memoryStore();
      const receipt = state.receipts.find((item) => item.idempotencyKey === command.groupIdempotencyKey);
      if (receipt) {
        if (receipt.requestHash !== command.requestHash) throw new Error('Import group idempotency key conflicts with its original payload.');
        return { ...(receipt.response as ContactImportGroupResult), noOp: true };
      }
      const linksBefore = structuredClone(state.links);
      const receiptsBefore = structuredClone(state.receipts);
      const operation = async (): Promise<ContactImportGroupResult> => {
        let contactId = command.plan.contactId;
        if (command.plan.action === 'create') {
          const created = await repository.create(command.plan.contact as Omit<Contact, 'id' | 'createdAt'>);
          contactId = created.id;
          if (activityRepository) await activityRepository.appendEvent(command.scope, {
            type: 'contact-created', contactId, actorMembershipId: command.scope.membershipId,
            occurredAt: command.occurredAt, idempotencyKey: `contact-created:${contactId}`,
          });
        } else {
          if (!contactId) throw new Error('Atomic import target is missing.');
          const existing = await repository.get(contactId);
          if (!existing || existing.archivedAt) throw new Error('Import target is missing or archived.');
          if (command.plan.action === 'update') {
            const patch = { ...command.plan.contact } as Partial<Contact> & { nextTouchAt?: string | null };
            if (patch.nextTouchAt === null) patch.nextTouchAt = undefined;
            await repository.update(contactId, patch as Partial<Contact>);
          }
        }
        if (!contactId) throw new Error('Atomic import did not resolve a contact.');
        const rich = options.richContactRepository;
        if ((command.plan.points.length || command.plan.householdIds.length
          || command.plan.assigneeMembershipIds.length || command.plan.customValues.length
          || command.plan.sourceProfile?.facts.length) && !rich) {
          throw new Error('Mapped rich-contact import requires the rich-contact transaction adapter.');
        }
        if (rich) {
          for (const point of command.plan.points) await rich.addContactPoint(command.scope, {
            contactId, ...point, actorMembershipId: command.scope.membershipId, occurredAt: command.occurredAt,
          });
          for (const householdId of command.plan.householdIds) await rich.addHouseholdMember(command.scope, {
            householdId, contactId, actorMembershipId: command.scope.membershipId, occurredAt: command.occurredAt,
          });
          for (const assigneeMembershipId of command.plan.assigneeMembershipIds) await rich.assignContact(command.scope, {
            contactId, assigneeMembershipId, actorMembershipId: command.scope.membershipId, occurredAt: command.occurredAt,
          });
          for (const item of command.plan.customValues) await rich.setCustomFieldValue(command.scope, {
            contactId, definitionId: item.definitionId, value: item.value,
            actorMembershipId: command.scope.membershipId, occurredAt: command.occurredAt,
          });
          if (command.plan.sourceProfile?.facts.length) {
            if (!rich.appendContactImportSourceFacts) {
              throw new Error('Atomic memory import requires source-fact persistence support.');
            }
            await rich.appendContactImportSourceFacts(command.scope, {
              contactId,
              provider: command.plan.sourceProfile.provider,
              schemaVersion: command.plan.sourceProfile.schemaVersion,
              facts: command.plan.sourceProfile.facts,
              groupIdempotencyKey: command.groupIdempotencyKey,
              requestHash: command.requestHash,
              capturedAt: command.occurredAt,
            });
          }
        }
        if (command.plan.externalLink) await saveLink({ ...command.plan.externalLink, contactId });
        let notesAdded = false;
        const note = command.plan.note?.trim();
        if (note) {
          const existingNotes = await repository.notesFor(contactId);
          if (!existingNotes.some((item) => item.body.trim() === note)) {
            const created = await repository.addNote(contactId, note);
            notesAdded = true;
            if (activityRepository) await activityRepository.appendEvent(command.scope, {
              type: 'note-added', contactId, actorMembershipId: command.scope.membershipId,
              occurredAt: command.occurredAt, idempotencyKey: `note-added:${created.id}`,
            });
          }
        }
        if (activityRepository) await activityRepository.appendEvent(command.scope, {
          type: 'contact-imported', contactId, actorMembershipId: command.scope.membershipId,
          occurredAt: command.occurredAt, idempotencyKey: command.plan.activityIdempotencyKey,
        });
        const result: ContactImportGroupResult = { contactId, action: command.plan.action, notesAdded, noOp: false };
        state.receipts.push({ idempotencyKey: command.groupIdempotencyKey, requestHash: command.requestHash,
          statusCode: 200, response: result, createdAt: command.occurredAt });
        return result;
      };
      try {
        return await repository.runTransaction(() => {
          const withRich = options.richContactRepository?.runTransaction
            ? () => options.richContactRepository!.runTransaction!(operation) : operation;
          return activityRepository?.runTransaction ? activityRepository.runTransaction(withRich) : withRich();
        });
      } catch (error) {
        state.links = linksBefore;
        state.receipts = receiptsBefore;
        throw error;
      }
    },
  };
}
