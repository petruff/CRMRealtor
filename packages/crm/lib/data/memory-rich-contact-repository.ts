import { createHash, randomUUID } from 'node:crypto';
import type { ContactRepository } from './repository.ts';
import type { ActivityRepository } from './activity-repository.ts';
import type { RichContactRepository } from './rich-contact-repository.ts';
import {
  CONTACT_POINT_LIMITS,
  RichContactError,
  validateCustomFieldValue,
  type ContactAssignment,
  type ContactCustomFieldValue,
  type ContactImportSourceFactRecord,
  type ContactPoint,
  type CustomFieldDefinition,
  type Household,
  type HouseholdMembership,
  type PersonRelationship,
} from '../domain/rich-contact.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

interface RichStore {
  points: ContactPoint[];
  households: Household[];
  householdMemberships: HouseholdMembership[];
  relationships: PersonRelationship[];
  assignments: ContactAssignment[];
  definitions: CustomFieldDefinition[];
  values: ContactCustomFieldValue[];
  sourceFacts: ContactImportSourceFactRecord[];
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function active<T extends { archivedAt?: string }>(records: readonly T[], includeArchived = false): T[] {
  return records.filter((record) => includeArchived || !record.archivedAt);
}

export function createMemoryRichContactRepository(input: {
  readonly contactRepository: ContactRepository;
  readonly activeMembershipIds: readonly string[];
  readonly activityRepository?: ActivityRepository;
}): RichContactRepository {
  const state: RichStore = {
    points: [], households: [], householdMemberships: [], relationships: [],
    assignments: [], definitions: [], values: [], sourceFacts: [],
  };
  const activeMemberships = new Set(input.activeMembershipIds);

  async function record(
    scope: WorkspaceScope,
    type: 'contact-archived' | 'contact-restored' | 'contact-point-added' | 'contact-point-updated'
      | 'contact-point-archived' | 'contact-point-restored' | 'household-updated'
      | 'relationship-updated' | 'assignment-updated' | 'custom-field-updated',
    actorMembershipId: string,
    occurredAt: string,
    idempotencyKey: string,
    contactId?: string,
  ): Promise<void> {
    if (!input.activityRepository) return;
    await input.activityRepository.appendEvent(scope, {
      type,
      ...(contactId ? { contactId } : {}),
      actorMembershipId,
      occurredAt,
      idempotencyKey,
    });
  }

  async function requireContact(contactId: string) {
    const contact = await input.contactRepository.get(contactId);
    if (!contact) throw new RichContactError('not-found', 'Contact was not found.');
    return contact;
  }

  function requireMembership(membershipId: string): void {
    if (!activeMemberships.has(membershipId)) {
      throw new RichContactError('forbidden', 'Assignment requires an active workspace member.');
    }
  }

  function pointById(scope: WorkspaceScope, pointId: string): ContactPoint {
    const point = state.points.find((item) => item.id === pointId && item.workspaceId === scope.workspaceId);
    if (!point) throw new RichContactError('not-found', 'Contact point was not found.');
    return point;
  }

  function assertPointInvariants(candidate: ContactPoint, excludingId?: string): void {
    const current = state.points.filter((point) => point.workspaceId === candidate.workspaceId
      && point.contactId === candidate.contactId && point.type === candidate.type
      && !point.archivedAt && point.id !== excludingId);
    if (current.length >= CONTACT_POINT_LIMITS[candidate.type]) {
      throw new RichContactError('conflict', `A contact may have at most ${CONTACT_POINT_LIMITS[candidate.type]} active ${candidate.type} points.`);
    }
    if (current.some((point) => point.normalizedValue === candidate.normalizedValue)) {
      throw new RichContactError('conflict', 'This contact already has the same active contact point.');
    }
    if (candidate.isPrimary && current.some((point) => point.isPrimary)) {
      throw new RichContactError('conflict', `This contact already has a primary ${candidate.type}.`);
    }
  }

  async function projectLegacy(contactId: string): Promise<void> {
    const points = state.points.filter((point) => point.contactId === contactId && !point.archivedAt)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)
        || left.displayOrder - right.displayOrder
        || left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id));
    const phones = points.filter((point) => point.type === 'phone');
    const emails = points.filter((point) => point.type === 'email');
    await input.contactRepository.update(contactId, {
      phone: phones[0]?.displayValue,
      secondaryPhone: phones[1]?.displayValue,
      email: emails[0]?.displayValue,
      emailSubscribed: emails[0]?.emailSubscribed,
    });
  }

  async function ensureLegacyPoints(scope: WorkspaceScope, contactId: string): Promise<void> {
    if (state.points.some((point) => point.workspaceId === scope.workspaceId && point.contactId === contactId)) return;
    const contact = await requireContact(contactId);
    const createdAt = contact.createdAt;
    const addLegacy = (type: ContactPoint['type'], label: string, displayValue: string, isPrimary: boolean, displayOrder: number) => {
      const normalizedValue = type === 'email'
        ? displayValue.trim().toLowerCase()
        : (() => {
          let digits = displayValue.replace(/\D/g, '');
          if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
          return digits;
        })();
      if (!normalizedValue) return;
      state.points.push({
        id: id('point'), workspaceId: scope.workspaceId, contactId, type, label,
        displayValue, normalizedValue, isPrimary, ...(type === 'email'
          ? { emailSubscribed: contact.emailSubscribed ?? true } : {}),
        displayOrder, createdAt, updatedAt: createdAt,
      });
    };
    if (contact.phone) addLegacy('phone', 'primary', contact.phone, true, 0);
    if (contact.secondaryPhone) {
      const primary = state.points.find((point) => point.contactId === contactId && point.type === 'phone');
      const normalized = contact.secondaryPhone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (!primary || primary.normalizedValue !== normalized) {
        addLegacy('phone', 'secondary', contact.secondaryPhone, false, 1);
      }
    }
    if (contact.email) addLegacy('email', 'primary', contact.email, true, 0);
  }

  return {
    async listContactPoints(scope, contactId, includeArchived) {
      await ensureLegacyPoints(scope, contactId);
      return active(state.points.filter((point) => point.workspaceId === scope.workspaceId
        && point.contactId === contactId), includeArchived)
        .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id));
    },

    async addContactPoint(scope, pointInput) {
      await requireContact(pointInput.contactId);
      await ensureLegacyPoints(scope, pointInput.contactId);
      const { actorMembershipId, occurredAt, ...pointFields } = pointInput;
      const point: ContactPoint = {
        id: id('point'), workspaceId: scope.workspaceId, ...pointFields,
        createdAt: occurredAt, updatedAt: occurredAt,
      };
      void actorMembershipId;
      assertPointInvariants(point);
      state.points.push(point);
      await projectLegacy(point.contactId);
      await record(scope, 'contact-point-added', actorMembershipId, occurredAt,
        `contact-point-added:${point.id}`, point.contactId);
      return point;
    },

    async updateContactPoint(scope, pointId, pointInput) {
      const point = pointById(scope, pointId);
      if (point.archivedAt) throw new RichContactError('conflict', 'Archived contact points cannot be edited.');
      const { actorMembershipId, occurredAt, ...pointFields } = pointInput;
      const updated: ContactPoint = { ...point, ...pointFields, updatedAt: occurredAt };
      void actorMembershipId;
      assertPointInvariants(updated, point.id);
      state.points[state.points.indexOf(point)] = updated;
      await projectLegacy(point.contactId);
      await record(scope, 'contact-point-updated', actorMembershipId, occurredAt,
        `contact-point-updated:${point.id}:${occurredAt}`, point.contactId);
      return updated;
    },

    async archiveContactPoint(scope, pointId, actorMembershipId, reason, occurredAt) {
      const point = pointById(scope, pointId);
      if (point.archivedAt) return point;
      const archived = { ...point, archivedAt: occurredAt, archivedByMembershipId: actorMembershipId, archiveReason: reason, updatedAt: occurredAt };
      state.points[state.points.indexOf(point)] = archived;
      await projectLegacy(point.contactId);
      await record(scope, 'contact-point-archived', actorMembershipId, occurredAt,
        `contact-point-archived:${point.id}`, point.contactId);
      return archived;
    },

    async restoreContactPoint(scope, pointId, actorMembershipId, occurredAt) {
      const point = pointById(scope, pointId);
      if (!point.archivedAt) return point;
      const restored = { ...point, updatedAt: occurredAt } as ContactPoint & {
        archivedAt?: string; archivedByMembershipId?: string; archiveReason?: string;
      };
      delete restored.archivedAt;
      delete restored.archivedByMembershipId;
      delete restored.archiveReason;
      assertPointInvariants(restored, point.id);
      void actorMembershipId;
      state.points[state.points.indexOf(point)] = restored;
      await projectLegacy(point.contactId);
      await record(scope, 'contact-point-restored', actorMembershipId, occurredAt,
        `contact-point-restored:${point.id}:${occurredAt}`, point.contactId);
      return restored;
    },

    async listHouseholds(scope, includeArchived) {
      return active(state.households.filter((item) => item.workspaceId === scope.workspaceId), includeArchived);
    },

    async createHousehold(scope, householdInput) {
      const household: Household = {
        id: id('household'), workspaceId: scope.workspaceId, name: householdInput.name,
        createdAt: householdInput.occurredAt, updatedAt: householdInput.occurredAt,
      };
      state.households.push(household);
      await record(scope, 'household-updated', householdInput.actorMembershipId,
        householdInput.occurredAt, `household-created:${household.id}`);
      return household;
    },

    async archiveHousehold(scope, householdId, actorMembershipId, occurredAt) {
      const household = state.households.find((item) => item.id === householdId && item.workspaceId === scope.workspaceId);
      if (!household) throw new RichContactError('not-found', 'Household was not found.');
      if (household.archivedAt) return household;
      const archived = { ...household, archivedAt: occurredAt, archivedByMembershipId: actorMembershipId, updatedAt: occurredAt };
      state.households[state.households.indexOf(household)] = archived;
      await record(scope, 'household-updated', actorMembershipId, occurredAt,
        `household-archived:${household.id}`);
      return archived;
    },

    async listHouseholdMembers(scope, householdId) {
      return state.householdMemberships.filter((item) => item.workspaceId === scope.workspaceId
        && item.householdId === householdId && !item.endedAt);
    },

    async addHouseholdMember(scope, memberInput) {
      await requireContact(memberInput.contactId);
      const household = state.households.find((item) => item.id === memberInput.householdId
        && item.workspaceId === scope.workspaceId && !item.archivedAt);
      if (!household) throw new RichContactError('not-found', 'Active household was not found.');
      const existing = state.householdMemberships.find((item) => item.householdId === memberInput.householdId
        && item.contactId === memberInput.contactId && !item.endedAt);
      if (existing) return existing;
      const membership: HouseholdMembership = {
        id: id('household-member'), workspaceId: scope.workspaceId,
        householdId: memberInput.householdId, contactId: memberInput.contactId,
        createdAt: memberInput.occurredAt, createdByMembershipId: memberInput.actorMembershipId,
      };
      state.householdMemberships.push(membership);
      await record(scope, 'household-updated', memberInput.actorMembershipId,
        memberInput.occurredAt, `household-member-added:${membership.id}`, memberInput.contactId);
      return membership;
    },

    async removeHouseholdMember(scope, householdId, contactId, actorMembershipId, occurredAt) {
      const membership = state.householdMemberships.find((item) => item.workspaceId === scope.workspaceId
        && item.householdId === householdId && item.contactId === contactId && !item.endedAt);
      if (!membership) return;
      state.householdMemberships[state.householdMemberships.indexOf(membership)] = {
        ...membership, endedAt: occurredAt, endedByMembershipId: actorMembershipId,
      };
      await record(scope, 'household-updated', actorMembershipId, occurredAt,
        `household-member-removed:${membership.id}:${occurredAt}`, contactId);
    },

    async listRelationships(scope, contactId, includeArchived) {
      return active(state.relationships.filter((item) => item.workspaceId === scope.workspaceId
        && (!contactId || item.firstContactId === contactId || item.secondContactId === contactId)), includeArchived);
    },

    async addRelationship(scope, relationshipInput) {
      await Promise.all([requireContact(relationshipInput.firstContactId), requireContact(relationshipInput.secondContactId)]);
      const existing = state.relationships.find((item) => item.workspaceId === scope.workspaceId
        && item.firstContactId === relationshipInput.firstContactId
        && item.secondContactId === relationshipInput.secondContactId && !item.archivedAt);
      if (existing) throw new RichContactError('conflict', 'These contacts already have an active relationship.');
      const { actorMembershipId, occurredAt, ...relationshipFields } = relationshipInput;
      const relationship: PersonRelationship = {
        id: id('relationship'), workspaceId: scope.workspaceId, ...relationshipFields,
        createdAt: occurredAt, createdByMembershipId: actorMembershipId,
      };
      state.relationships.push(relationship);
      await record(scope, 'relationship-updated', actorMembershipId, occurredAt,
        `relationship-added:${relationship.id}`, relationship.firstContactId);
      return relationship;
    },

    async archiveRelationship(scope, relationshipId, actorMembershipId, occurredAt) {
      const relationship = state.relationships.find((item) => item.id === relationshipId
        && item.workspaceId === scope.workspaceId);
      if (!relationship) throw new RichContactError('not-found', 'Relationship was not found.');
      if (relationship.archivedAt) return relationship;
      const archived = { ...relationship, archivedAt: occurredAt, archivedByMembershipId: actorMembershipId };
      state.relationships[state.relationships.indexOf(relationship)] = archived;
      await record(scope, 'relationship-updated', actorMembershipId, occurredAt,
        `relationship-archived:${relationship.id}`, relationship.firstContactId);
      return archived;
    },

    async restoreRelationship(scope, relationshipId, actorMembershipId, occurredAt) {
      const relationship = state.relationships.find((item) => item.id === relationshipId
        && item.workspaceId === scope.workspaceId);
      if (!relationship) throw new RichContactError('not-found', 'Relationship was not found.');
      if (!relationship.archivedAt) return relationship;
      const duplicate = state.relationships.some((item) => item.id !== relationship.id
        && item.workspaceId === scope.workspaceId && !item.archivedAt
        && item.firstContactId === relationship.firstContactId && item.secondContactId === relationship.secondContactId);
      if (duplicate) throw new RichContactError('conflict', 'Restoring would duplicate an active relationship.');
      const restored = { ...relationship } as PersonRelationship & { archivedAt?: string; archivedByMembershipId?: string };
      delete restored.archivedAt;
      delete restored.archivedByMembershipId;
      void actorMembershipId;
      void occurredAt;
      state.relationships[state.relationships.indexOf(relationship)] = restored;
      await record(scope, 'relationship-updated', actorMembershipId, occurredAt,
        `relationship-restored:${relationship.id}:${occurredAt}`, relationship.firstContactId);
      return restored;
    },

    async listAssignments(scope, contactId, includeUnassigned) {
      return state.assignments.filter((item) => item.workspaceId === scope.workspaceId
        && (!contactId || item.contactId === contactId) && (includeUnassigned || !item.unassignedAt));
    },

    async assignContact(scope, assignmentInput) {
      await requireContact(assignmentInput.contactId);
      requireMembership(assignmentInput.assigneeMembershipId);
      const existing = state.assignments.find((item) => item.workspaceId === scope.workspaceId
        && item.contactId === assignmentInput.contactId
        && item.assigneeMembershipId === assignmentInput.assigneeMembershipId && !item.unassignedAt);
      if (existing) return existing;
      const assignment: ContactAssignment = {
        id: id('assignment'), workspaceId: scope.workspaceId,
        contactId: assignmentInput.contactId, assigneeMembershipId: assignmentInput.assigneeMembershipId,
        assignedAt: assignmentInput.occurredAt, assignedByMembershipId: assignmentInput.actorMembershipId,
      };
      state.assignments.push(assignment);
      await record(scope, 'assignment-updated', assignmentInput.actorMembershipId,
        assignmentInput.occurredAt, `assignment-added:${assignment.id}`, assignment.contactId);
      return assignment;
    },

    async unassignContact(scope, assignmentId, actorMembershipId, occurredAt) {
      const assignment = state.assignments.find((item) => item.id === assignmentId
        && item.workspaceId === scope.workspaceId);
      if (!assignment) throw new RichContactError('not-found', 'Assignment was not found.');
      if (assignment.unassignedAt) return assignment;
      const unassigned = { ...assignment, unassignedAt: occurredAt, unassignedByMembershipId: actorMembershipId };
      state.assignments[state.assignments.indexOf(assignment)] = unassigned;
      await record(scope, 'assignment-updated', actorMembershipId, occurredAt,
        `assignment-removed:${assignment.id}`, assignment.contactId);
      return unassigned;
    },

    async listCustomFieldDefinitions(scope, includeArchived) {
      return active(state.definitions.filter((item) => item.workspaceId === scope.workspaceId), includeArchived)
        .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
    },

    async createCustomFieldDefinition(scope, definitionInput) {
      const duplicate = state.definitions.some((item) => item.workspaceId === scope.workspaceId
        && !item.archivedAt && item.name.toLowerCase() === definitionInput.name.toLowerCase());
      if (duplicate) throw new RichContactError('conflict', 'An active custom field already has this name.');
      const definition: CustomFieldDefinition = {
        id: id('custom-field'), workspaceId: scope.workspaceId, name: definitionInput.name,
        type: definitionInput.type, options: [...definitionInput.options],
        displayOrder: definitionInput.displayOrder,
        createdAt: definitionInput.occurredAt, updatedAt: definitionInput.occurredAt,
      };
      state.definitions.push(definition);
      await record(scope, 'custom-field-updated', definitionInput.actorMembershipId,
        definitionInput.occurredAt, `custom-field-created:${definition.id}`);
      return definition;
    },

    async archiveCustomFieldDefinition(scope, definitionId, actorMembershipId, occurredAt) {
      const definition = state.definitions.find((item) => item.id === definitionId
        && item.workspaceId === scope.workspaceId);
      if (!definition) throw new RichContactError('not-found', 'Custom field definition was not found.');
      if (definition.archivedAt) return definition;
      const archived = { ...definition, archivedAt: occurredAt, archivedByMembershipId: actorMembershipId, updatedAt: occurredAt };
      state.definitions[state.definitions.indexOf(definition)] = archived;
      await record(scope, 'custom-field-updated', actorMembershipId, occurredAt,
        `custom-field-archived:${definition.id}`);
      return archived;
    },

    async listCustomFieldValues(scope, contactId) {
      return state.values.filter((item) => item.workspaceId === scope.workspaceId && item.contactId === contactId);
    },

    async setCustomFieldValue(scope, valueInput) {
      await requireContact(valueInput.contactId);
      const definition = state.definitions.find((item) => item.id === valueInput.definitionId
        && item.workspaceId === scope.workspaceId);
      if (!definition) throw new RichContactError('not-found', 'Custom field definition was not found.');
      const value = validateCustomFieldValue(definition, valueInput.value);
      const existing = state.values.find((item) => item.workspaceId === scope.workspaceId
        && item.contactId === valueInput.contactId && item.definitionId === valueInput.definitionId);
      const valueRecord: ContactCustomFieldValue = {
        id: existing?.id ?? id('custom-value'), workspaceId: scope.workspaceId,
        contactId: valueInput.contactId, definitionId: valueInput.definitionId, value,
        updatedAt: valueInput.occurredAt, updatedByMembershipId: valueInput.actorMembershipId,
      };
      if (existing) state.values[state.values.indexOf(existing)] = valueRecord;
      else state.values.push(valueRecord);
      await record(scope, 'custom-field-updated', valueInput.actorMembershipId,
        valueInput.occurredAt, `custom-field-value:${valueRecord.id}:${valueInput.occurredAt}`, valueRecord.contactId);
      return valueRecord;
    },

    async listContactImportSourceFacts(scope, contactId) {
      return state.sourceFacts
        .filter((item) => item.workspaceId === scope.workspaceId && item.contactId === contactId)
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)
          || left.category.localeCompare(right.category) || left.label.localeCompare(right.label));
    },

    async appendContactImportSourceFacts(scope, sourceInput) {
      await requireContact(sourceInput.contactId);
      for (const fact of sourceInput.facts) {
        const valueHash = createHash('sha256').update(JSON.stringify(fact.value)).digest('hex');
        const existing = state.sourceFacts.find((item) => item.workspaceId === scope.workspaceId
          && item.groupIdempotencyKey === sourceInput.groupIdempotencyKey && item.key === fact.key);
        if (existing) {
          if (existing.requestHash !== sourceInput.requestHash || existing.valueHash !== valueHash) {
            throw new RichContactError('conflict', 'Import source fact conflicts with its original payload.');
          }
          continue;
        }
        state.sourceFacts.push({
          id: id('source-fact'), workspaceId: scope.workspaceId, contactId: sourceInput.contactId,
          provider: sourceInput.provider, schemaVersion: sourceInput.schemaVersion,
          ...fact, valueHash, groupIdempotencyKey: sourceInput.groupIdempotencyKey,
          requestHash: sourceInput.requestHash, capturedAt: sourceInput.capturedAt,
        });
      }
    },

    async getContactArchive(scope, contactId) {
      const contact = await input.contactRepository.get(contactId);
      if (!contact) return undefined;
      return {
        contactId, workspaceId: scope.workspaceId,
        ...(contact.archivedAt ? { archivedAt: contact.archivedAt } : {}),
        ...(contact.archivedByMembershipId ? { archivedByMembershipId: contact.archivedByMembershipId } : {}),
        ...(contact.archiveReason ? { archiveReason: contact.archiveReason } : {}),
      };
    },

    async archiveContact(scope, contactId, actorMembershipId, reason, occurredAt) {
      const contact = await requireContact(contactId);
      if (!contact.archivedAt) {
        await input.contactRepository.update(contactId, {
          archivedAt: occurredAt, archivedByMembershipId: actorMembershipId, archiveReason: reason,
          nextTouchAt: undefined, touchDateOverridden: false,
        });
        await record(scope, 'contact-archived', actorMembershipId, occurredAt,
          `contact-archived:${contactId}`, contactId);
      }
      return { contactId, workspaceId: scope.workspaceId, archivedAt: contact.archivedAt ?? occurredAt,
        archivedByMembershipId: contact.archivedByMembershipId ?? actorMembershipId,
        archiveReason: contact.archiveReason ?? reason };
    },

    async restoreContact(scope, contactId, actorMembershipId, occurredAt) {
      await requireContact(contactId);
      await input.contactRepository.update(contactId, {
        archivedAt: undefined,
        archivedByMembershipId: undefined,
        archiveReason: undefined,
      });
      await record(scope, 'contact-restored', actorMembershipId, occurredAt,
        `contact-restored:${contactId}:${occurredAt}`, contactId);
      return { contactId, workspaceId: scope.workspaceId };
    },
    async runTransaction(operation) {
      const before = structuredClone(state);
      try {
        return await operation();
      } catch (error) {
        state.points = before.points;
        state.households = before.households;
        state.householdMemberships = before.householdMemberships;
        state.relationships = before.relationships;
        state.assignments = before.assignments;
        state.definitions = before.definitions;
        state.values = before.values;
        state.sourceFacts = before.sourceFacts;
        throw error;
      }
    },
  };
}
