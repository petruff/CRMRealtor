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

export const CONTACT_INTAKE_PENDING_STATUS = 102;

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
  /** Durable terminal evidence written in the same transaction as the mutation. */
  readonly terminalReceipt: {
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly statusCode: 200;
    readonly createdAt: string;
  };
}

export const MAX_CONTACT_IMPORT_PLAN_ROWS = 5_000;

export type ContactImportOrderedPlanRow =
  | {
      readonly rowNumber: number;
      readonly kind: 'apply';
      readonly groupIdempotencyKey: string;
      readonly requestHash: string;
      readonly plan: ContactImportGroupPlan;
      readonly errorCode?: string;
    }
  | {
      readonly rowNumber: number;
      readonly kind: 'quarantine';
      readonly source: string;
      readonly externalId?: string;
      readonly candidate: Record<string, unknown>;
      readonly reasons: readonly Record<string, unknown>[];
      readonly intakeIdempotencyKey: string;
      readonly errorCode?: string;
    }
  | {
      readonly rowNumber: number;
      readonly kind: 'reject';
      readonly errorCode: string;
    }
  | {
      readonly rowNumber: number;
      readonly kind: 'alias';
      readonly targetRowNumber: number;
      readonly errorCode?: string;
    };

export interface ContactImportPlanCommand {
  readonly scope: WorkspaceScope;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly source: string;
  readonly format: 'csv' | 'vcard' | 'xls' | 'xlsx' | 'numbers' | 'json';
  readonly fileHash: string;
  readonly orderedPlan: readonly ContactImportOrderedPlanRow[];
  readonly mappingProfileId?: string;
  readonly mappingVersion?: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly correlationId: string;
}

export interface ContactImportPlanRowOutcome {
  readonly rowNumber: number;
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'rejected' | 'quarantined';
  readonly contactId?: string;
  readonly incompleteRecordId?: string;
  readonly errorCode?: string;
}

export interface ContactImportPlanResult {
  readonly state: 'recorded';
  readonly runId: string;
  readonly planHash: string;
  readonly counts: {
    readonly total: number;
    readonly created: number;
    readonly updated: number;
    readonly unchanged: number;
    readonly rejected: number;
    readonly quarantined: number;
    readonly failed: 0;
    readonly notesAdded: number;
  };
  readonly rowOutcomes: readonly ContactImportPlanRowOutcome[];
  readonly noOp: boolean;
}

const IMPORT_ERROR_CODE = /^[a-z][a-z0-9_.-]{1,79}(,[a-z][a-z0-9_.-]{1,79}){0,3}$/;

function boundedImportCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_CONTACT_IMPORT_PLAN_ROWS) {
    throw new Error('Atomic import plan returned invalid aggregate counts.');
  }
  return Number(value);
}

/** Validates an immutable aggregate receipt without consulting mutable contact state. */
export function validateStoredContactImportPlanResult(value: unknown): ContactImportPlanResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Atomic import plan returned an invalid terminal envelope.');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.state !== 'recorded' || typeof envelope.runId !== 'string' || !envelope.runId
    || typeof envelope.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.planHash)
    || typeof envelope.noOp !== 'boolean' || !Array.isArray(envelope.rowOutcomes)
    || !envelope.counts || typeof envelope.counts !== 'object' || Array.isArray(envelope.counts)) {
    throw new Error('Atomic import plan returned an invalid terminal envelope.');
  }
  const countsValue = envelope.counts as Record<string, unknown>;
  const counts = {
    total: boundedImportCount(countsValue.total),
    created: boundedImportCount(countsValue.created),
    updated: boundedImportCount(countsValue.updated),
    unchanged: boundedImportCount(countsValue.unchanged),
    rejected: boundedImportCount(countsValue.rejected),
    quarantined: boundedImportCount(countsValue.quarantined),
    failed: boundedImportCount(countsValue.failed),
    notesAdded: boundedImportCount(countsValue.notesAdded),
  };
  if (counts.failed !== 0
    || counts.created + counts.updated + counts.unchanged + counts.rejected + counts.quarantined !== counts.total
    || envelope.rowOutcomes.length !== counts.total) {
    throw new Error('Atomic import plan aggregate counts disagree with its ordered rows.');
  }
  const observed = { created: 0, updated: 0, unchanged: 0, rejected: 0, quarantined: 0 };
  let previousRowNumber = 0;
  const rowOutcomes = envelope.rowOutcomes.map((value): ContactImportPlanRowOutcome => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Atomic import plan returned an invalid row outcome.');
    }
    const row = value as Record<string, unknown>;
    const rowNumber = Number(row.rowNumber);
    const outcome = String(row.outcome);
    if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRowNumber
      || !['created', 'updated', 'unchanged', 'rejected', 'quarantined'].includes(outcome)
      || (row.contactId !== undefined && typeof row.contactId !== 'string')
      || (row.incompleteRecordId !== undefined && typeof row.incompleteRecordId !== 'string')
      || (row.errorCode !== undefined
        && (typeof row.errorCode !== 'string' || !IMPORT_ERROR_CODE.test(row.errorCode)))) {
      throw new Error('Atomic import plan returned an invalid row outcome.');
    }
    if ((['created', 'updated', 'unchanged'].includes(outcome) && typeof row.contactId !== 'string')
      || (outcome === 'quarantined' && typeof row.incompleteRecordId !== 'string')) {
      throw new Error('Atomic import plan outcome disagrees with its ordered command.');
    }
    previousRowNumber = rowNumber;
    observed[outcome as keyof typeof observed] += 1;
    return {
      rowNumber,
      outcome: outcome as ContactImportPlanRowOutcome['outcome'],
      ...(typeof row.contactId === 'string' ? { contactId: row.contactId } : {}),
      ...(typeof row.incompleteRecordId === 'string' ? { incompleteRecordId: row.incompleteRecordId } : {}),
      ...(typeof row.errorCode === 'string' ? { errorCode: row.errorCode } : {}),
    };
  });
  if (observed.created !== counts.created || observed.updated !== counts.updated
    || observed.unchanged !== counts.unchanged || observed.rejected !== counts.rejected
    || observed.quarantined !== counts.quarantined) {
    throw new Error('Atomic import plan aggregate counts disagree with its ordered rows.');
  }
  return {
    state: 'recorded',
    runId: envelope.runId,
    planHash: envelope.planHash,
    counts: { ...counts, failed: 0 },
    rowOutcomes,
    noOp: envelope.noOp,
  };
}

/** Validates the aggregate receipt against the exact ordered command that produced it. */
export function validateContactImportPlanResult(
  value: unknown,
  orderedPlan: readonly ContactImportOrderedPlanRow[],
): ContactImportPlanResult {
  if (orderedPlan.length > MAX_CONTACT_IMPORT_PLAN_ROWS) {
    throw new Error('Atomic import plan returned an invalid terminal envelope.');
  }
  const receipt = validateStoredContactImportPlanResult(value);
  if (receipt.counts.total !== orderedPlan.length) {
    throw new Error('Atomic import plan aggregate counts disagree with its ordered rows.');
  }
  receipt.rowOutcomes.forEach((row, index) => {
    const expected = orderedPlan[index];
    const expectedOutcomes = expected?.kind === 'apply'
      ? ['created', 'updated', 'unchanged']
      : expected?.kind === 'alias' ? ['unchanged']
        : [expected?.kind === 'reject' ? 'rejected' : 'quarantined'];
    if (!expected || row.rowNumber !== expected.rowNumber || !expectedOutcomes.includes(row.outcome)) {
      throw new Error('Atomic import plan outcome disagrees with its ordered command.');
    }
  });
  return receipt;
}

export function verifyContactImportPlanOutcome(input: {
  readonly command: ContactImportPlanCommand;
  readonly mutation: unknown;
  readonly receipt: IntakeReceipt | undefined;
}): ContactImportPlanResult {
  const mutation = validateContactImportPlanResult(input.mutation, input.command.orderedPlan);
  const receipt = input.receipt;
  if (!receipt || receipt.idempotencyKey !== input.command.idempotencyKey
    || receipt.requestHash !== input.command.requestHash || receipt.statusCode !== 200) {
    throw new Error('Atomic import plan terminal receipt is missing or does not match its request.');
  }
  const durable = validateContactImportPlanResult(receipt.response, input.command.orderedPlan);
  if (durable.planHash !== mutation.planHash
    || JSON.stringify(durable) !== JSON.stringify({ ...mutation, noOp: durable.noOp })) {
    throw new Error('Atomic import plan result does not match its durable terminal receipt.');
  }
  return durable;
}

type ContactImportGroupMutation = Omit<ContactImportGroupResult, 'terminalReceipt'>;

function contactImportGroupMutation(value: unknown): ContactImportGroupMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Atomic import returned an invalid mutation outcome.');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.contactId !== 'string'
    || !['create', 'update', 'unchanged'].includes(String(row.action))
    || typeof row.notesAdded !== 'boolean'
    || typeof row.noOp !== 'boolean') {
    throw new Error('Atomic import returned an invalid mutation outcome.');
  }
  return {
    contactId: row.contactId,
    action: row.action as ContactImportGroupMutation['action'],
    notesAdded: row.notesAdded,
    noOp: row.noOp,
  };
}

/** Fails closed unless the RPC result is backed by its exact durable receipt. */
export function verifyContactImportGroupOutcome(input: {
  readonly command: ContactImportGroupCommand;
  readonly mutation: unknown;
  readonly receipt: IntakeReceipt | undefined;
}): ContactImportGroupResult {
  const mutation = contactImportGroupMutation(input.mutation);
  const receipt = input.receipt;
  if (!receipt || receipt.idempotencyKey !== input.command.groupIdempotencyKey
    || receipt.requestHash !== input.command.requestHash || receipt.statusCode !== 200
    || !Number.isFinite(new Date(receipt.createdAt).getTime())) {
    throw new Error('Atomic import terminal receipt is missing or does not match the committed request.');
  }
  const recorded = contactImportGroupMutation(receipt.response);
  if (mutation.contactId !== recorded.contactId || mutation.action !== recorded.action
    || mutation.notesAdded !== recorded.notesAdded || mutation.action !== input.command.plan.action) {
    throw new Error('Atomic import mutation and terminal receipt disagree.');
  }
  return {
    ...mutation,
    terminalReceipt: {
      idempotencyKey: receipt.idempotencyKey,
      requestHash: receipt.requestHash,
      statusCode: 200,
      createdAt: receipt.createdAt,
    },
  };
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
  claimReceipt(receipt: IntakeReceipt, correlationId: string): Promise<boolean>;
  completeReceipt(receipt: IntakeReceipt, correlationId: string): Promise<void>;
  resolveContactImportIdentity?(input: {
    scope: WorkspaceScope; provider: string; externalId?: string; email?: string; phone?: string;
  }): Promise<ContactImportIdentityResult>;
  applyContactImportGroup(command: ContactImportGroupCommand): Promise<ContactImportGroupResult>;
  /** Live capability: one RPC owns every mutation and the terminal aggregate receipt. */
  applyContactImportPlan?(command: ContactImportPlanCommand): Promise<ContactImportPlanResult>;
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
      if (receipt.statusCode !== CONTACT_INTAKE_PENDING_STATUS) {
        throw new Error('Intake receipt reservation must use the pending status.');
      }
      const state = memoryStore();
      if (state.receipts.some((item) => item.idempotencyKey === receipt.idempotencyKey)) return false;
      state.receipts.push({ ...receipt });
      return true;
    },
    async completeReceipt(receipt) {
      if (receipt.statusCode < 200 || receipt.statusCode > 599) {
        throw new Error('Intake receipt finalization requires a terminal status.');
      }
      const state = memoryStore();
      const index = state.receipts.findIndex(
        (item) => item.idempotencyKey === receipt.idempotencyKey && item.requestHash === receipt.requestHash,
      );
      if (index < 0) throw new Error('Intake receipt reservation was lost.');
      if (state.receipts[index]?.statusCode !== CONTACT_INTAKE_PENDING_STATUS) {
        const current = state.receipts[index];
        if (current?.statusCode === receipt.statusCode
          && JSON.stringify(current.response) === JSON.stringify(receipt.response)) return;
        throw new Error('Intake receipt is already terminal and immutable.');
      }
      state.receipts[index] = { ...receipt };
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
        return verifyContactImportGroupOutcome({
          command,
          mutation: { ...(receipt.response as ContactImportGroupMutation), noOp: true },
          receipt,
        });
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
        const result: ContactImportGroupMutation = { contactId, action: command.plan.action, notesAdded, noOp: false };
        state.receipts.push({ idempotencyKey: command.groupIdempotencyKey, requestHash: command.requestHash,
          statusCode: 200, response: result, createdAt: command.occurredAt });
        return verifyContactImportGroupOutcome({
          command,
          mutation: result,
          receipt: state.receipts.at(-1),
        });
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
