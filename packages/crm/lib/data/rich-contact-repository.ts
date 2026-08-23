import type { WorkspaceScope } from '../domain/workspace.ts';
import type {
  ContactArchiveRecord,
  ContactAssignment,
  ContactCustomFieldValue,
  ContactImportSourceFactRecord,
  ContactPoint,
  ContactPointType,
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldValue,
  Household,
  HouseholdMembership,
  PersonRelationship,
  PersonRelationshipKind,
} from '../domain/rich-contact.ts';

export interface ContactPointInput {
  readonly contactId: string;
  readonly type: ContactPointType;
  readonly label: string;
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly isPrimary: boolean;
  readonly emailSubscribed?: boolean;
  readonly displayOrder: number;
  readonly actorMembershipId: string;
  readonly occurredAt: string;
}

export interface RichContactRepository {
  listContactPoints(scope: WorkspaceScope, contactId: string, includeArchived?: boolean): Promise<readonly ContactPoint[]>;
  listContactPointsForContacts(scope: WorkspaceScope, contactIds: readonly string[], includeArchived?: boolean): Promise<readonly ContactPoint[]>;
  addContactPoint(scope: WorkspaceScope, input: ContactPointInput): Promise<ContactPoint>;
  updateContactPoint(scope: WorkspaceScope, pointId: string, input: Omit<ContactPointInput, 'contactId' | 'type'>): Promise<ContactPoint>;
  archiveContactPoint(scope: WorkspaceScope, pointId: string, actorMembershipId: string, reason: string, occurredAt: string): Promise<ContactPoint>;
  restoreContactPoint(scope: WorkspaceScope, pointId: string, actorMembershipId: string, occurredAt: string): Promise<ContactPoint>;

  listHouseholds(scope: WorkspaceScope, includeArchived?: boolean): Promise<readonly Household[]>;
  createHousehold(scope: WorkspaceScope, input: { name: string; actorMembershipId: string; occurredAt: string }): Promise<Household>;
  archiveHousehold(scope: WorkspaceScope, householdId: string, actorMembershipId: string, occurredAt: string): Promise<Household>;
  listHouseholdMembers(scope: WorkspaceScope, householdId: string): Promise<readonly HouseholdMembership[]>;
  addHouseholdMember(scope: WorkspaceScope, input: { householdId: string; contactId: string; actorMembershipId: string; occurredAt: string }): Promise<HouseholdMembership>;
  removeHouseholdMember(scope: WorkspaceScope, householdId: string, contactId: string, actorMembershipId: string, occurredAt: string): Promise<void>;

  listRelationships(scope: WorkspaceScope, contactId?: string, includeArchived?: boolean): Promise<readonly PersonRelationship[]>;
  addRelationship(scope: WorkspaceScope, input: { firstContactId: string; secondContactId: string; kind: PersonRelationshipKind; label?: string; actorMembershipId: string; occurredAt: string }): Promise<PersonRelationship>;
  archiveRelationship(scope: WorkspaceScope, relationshipId: string, actorMembershipId: string, occurredAt: string): Promise<PersonRelationship>;
  restoreRelationship(scope: WorkspaceScope, relationshipId: string, actorMembershipId: string, occurredAt: string): Promise<PersonRelationship>;

  listAssignments(scope: WorkspaceScope, contactId?: string, includeUnassigned?: boolean): Promise<readonly ContactAssignment[]>;
  assignContact(scope: WorkspaceScope, input: { contactId: string; assigneeMembershipId: string; actorMembershipId: string; occurredAt: string }): Promise<ContactAssignment>;
  unassignContact(scope: WorkspaceScope, assignmentId: string, actorMembershipId: string, occurredAt: string): Promise<ContactAssignment>;

  listCustomFieldDefinitions(scope: WorkspaceScope, includeArchived?: boolean): Promise<readonly CustomFieldDefinition[]>;
  createCustomFieldDefinition(scope: WorkspaceScope, input: { name: string; type: CustomFieldType; options: readonly string[]; displayOrder: number; actorMembershipId: string; occurredAt: string }): Promise<CustomFieldDefinition>;
  archiveCustomFieldDefinition(scope: WorkspaceScope, definitionId: string, actorMembershipId: string, occurredAt: string): Promise<CustomFieldDefinition>;
  listCustomFieldValues(scope: WorkspaceScope, contactId: string): Promise<readonly ContactCustomFieldValue[]>;
  setCustomFieldValue(scope: WorkspaceScope, input: { contactId: string; definitionId: string; value: CustomFieldValue; actorMembershipId: string; occurredAt: string }): Promise<ContactCustomFieldValue>;

  listContactImportSourceFacts(scope: WorkspaceScope, contactId: string): Promise<readonly ContactImportSourceFactRecord[]>;
  /** Memory-only atomic import seam; live writes remain inside apply_contact_import_group. */
  appendContactImportSourceFacts?(scope: WorkspaceScope, input: {
    contactId: string;
    provider: string;
    schemaVersion: string;
    facts: readonly Omit<ContactImportSourceFactRecord,
      'id' | 'workspaceId' | 'contactId' | 'provider' | 'schemaVersion' | 'valueHash'
      | 'groupIdempotencyKey' | 'requestHash' | 'capturedAt'>[];
    groupIdempotencyKey: string;
    requestHash: string;
    capturedAt: string;
  }): Promise<void>;

  getContactArchive(scope: WorkspaceScope, contactId: string): Promise<ContactArchiveRecord | undefined>;
  archiveContact(scope: WorkspaceScope, contactId: string, actorMembershipId: string, reason: string, occurredAt: string): Promise<ContactArchiveRecord>;
  restoreContact(scope: WorkspaceScope, contactId: string, actorMembershipId: string, occurredAt: string): Promise<ContactArchiveRecord>;
  /** Memory-only rollback boundary; live atomic workflows use database RPCs. */
  runTransaction?<T>(operation: () => Promise<T>): Promise<T>;
}
