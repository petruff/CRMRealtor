import type { RichContactRepository } from '../data/rich-contact-repository.ts';
import {
  CONTACT_POINT_TYPES,
  CUSTOM_FIELD_TYPES,
  RichContactError,
  canonicalRelationshipPair,
  normalizeContactPointValue,
  parseRelationshipKind,
  parseRichContactIdentifier,
  parseRichContactText,
  requireOwnerScope,
  validateCustomFieldValue,
  type ContactPointType,
  type CustomFieldType,
} from '../domain/rich-contact.ts';
import { hasImportedContactSuppression } from './contact-import.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';

function timestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RichContactError('invalid-input', 'Timestamp is invalid.');
  return now.toISOString();
}

function boolean(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new RichContactError('invalid-input', `${field} must be true or false.`);
}

function integer(value: unknown, field: string, fallback = 0, max = 10_000): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new RichContactError('invalid-input', `${field} must be 0–${max}.`);
  }
  return parsed;
}

function typeValue(value: unknown): ContactPointType {
  if (!CONTACT_POINT_TYPES.includes(value as ContactPointType)) {
    throw new RichContactError('invalid-input', 'Contact point type is invalid.');
  }
  return value as ContactPointType;
}

function options(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    throw new RichContactError('invalid-input', 'Custom field options are invalid.');
  }
  const parsed = value.map((item) => parseRichContactText(item, 'options', 120) ?? '');
  if (new Set(parsed).size !== parsed.length) {
    throw new RichContactError('invalid-input', 'Custom field options must be unique.');
  }
  return parsed;
}

export async function listContactPointsCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
  includeArchived = false,
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.listContactPoints(
    scope,
    parseRichContactIdentifier(contactId, 'contactId'),
    includeArchived,
  );
}

export async function addContactPointCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  input: {
    contactId?: unknown;
    type?: unknown;
    label?: unknown;
    displayValue?: unknown;
    isPrimary?: unknown;
    emailSubscribed?: unknown;
    displayOrder?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const type = typeValue(input.type);
  const normalized = normalizeContactPointValue(type, input.displayValue);
  const label = parseRichContactText(input.label, 'label', 80) ?? '';
  return repository.addContactPoint(scope, {
    contactId: parseRichContactIdentifier(input.contactId, 'contactId'),
    type,
    label,
    ...normalized,
    isPrimary: boolean(input.isPrimary, 'isPrimary'),
    ...(type === 'email' ? {
      emailSubscribed: hasImportedContactSuppression({ tags: [label] })
        ? false
        : boolean(input.emailSubscribed, 'emailSubscribed'),
    } : {}),
    displayOrder: integer(input.displayOrder, 'displayOrder'),
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function updateContactPointCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  input: {
    pointId?: unknown;
    type?: unknown;
    label?: unknown;
    displayValue?: unknown;
    isPrimary?: unknown;
    emailSubscribed?: unknown;
    displayOrder?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const type = typeValue(input.type);
  const normalized = normalizeContactPointValue(type, input.displayValue);
  const label = parseRichContactText(input.label, 'label', 80) ?? '';
  const suppressEmail = type === 'email' && hasImportedContactSuppression({ tags: [label] });
  return repository.updateContactPoint(
    scope,
    parseRichContactIdentifier(input.pointId, 'pointId'),
    {
      label,
      ...normalized,
      isPrimary: boolean(input.isPrimary, 'isPrimary'),
      ...(type === 'email' && (input.emailSubscribed !== undefined || suppressEmail)
        ? { emailSubscribed: suppressEmail ? false : boolean(input.emailSubscribed, 'emailSubscribed') }
        : {}),
      displayOrder: integer(input.displayOrder, 'displayOrder'),
      actorMembershipId: scope.membershipId,
      occurredAt: timestamp(now),
    },
  );
}

export async function archiveContactPointCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  pointId: unknown,
  reason: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.archiveContactPoint(
    scope,
    parseRichContactIdentifier(pointId, 'pointId'),
    scope.membershipId,
    parseRichContactText(reason, 'reason', 240) ?? '',
    timestamp(now),
  );
}

export async function restoreContactPointCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  pointId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.restoreContactPoint(
    scope,
    parseRichContactIdentifier(pointId, 'pointId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function listHouseholdsCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  includeArchived = false,
) {
  return repository.listHouseholds(validateWorkspaceScope(scopeInput), includeArchived);
}

export async function createHouseholdCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  name: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.createHousehold(scope, {
    name: parseRichContactText(name, 'name', 80) ?? '',
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function archiveHouseholdCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  householdId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.archiveHousehold(
    scope,
    parseRichContactIdentifier(householdId, 'householdId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function listHouseholdMembersCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  householdId: unknown,
) {
  return repository.listHouseholdMembers(
    validateWorkspaceScope(scopeInput),
    parseRichContactIdentifier(householdId, 'householdId'),
  );
}

export async function addHouseholdMemberCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  householdId: unknown,
  contactId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.addHouseholdMember(scope, {
    householdId: parseRichContactIdentifier(householdId, 'householdId'),
    contactId: parseRichContactIdentifier(contactId, 'contactId'),
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function removeHouseholdMemberCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  householdId: unknown,
  contactId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.removeHouseholdMember(
    scope,
    parseRichContactIdentifier(householdId, 'householdId'),
    parseRichContactIdentifier(contactId, 'contactId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function addPersonRelationshipCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  input: { firstContactId?: unknown; secondContactId?: unknown; kind?: unknown; label?: unknown },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const [firstContactId, secondContactId] = canonicalRelationshipPair(
    input.firstContactId,
    input.secondContactId,
  );
  const relationship = parseRelationshipKind(input.kind, input.label);
  return repository.addRelationship(scope, {
    firstContactId,
    secondContactId,
    ...relationship,
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function listRelationshipsCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId?: unknown,
  includeArchived = false,
) {
  return repository.listRelationships(
    validateWorkspaceScope(scopeInput),
    contactId === undefined ? undefined : parseRichContactIdentifier(contactId, 'contactId'),
    includeArchived,
  );
}

export async function archivePersonRelationshipCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  relationshipId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.archiveRelationship(
    scope,
    parseRichContactIdentifier(relationshipId, 'relationshipId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function restorePersonRelationshipCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  relationshipId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.restoreRelationship(
    scope,
    parseRichContactIdentifier(relationshipId, 'relationshipId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function listAssignmentsCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId?: unknown,
  includeUnassigned = false,
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.listAssignments(
    scope,
    contactId === undefined ? undefined : parseRichContactIdentifier(contactId, 'contactId'),
    includeUnassigned,
  );
}

export async function assignContactCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
  assigneeMembershipId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.assignContact(scope, {
    contactId: parseRichContactIdentifier(contactId, 'contactId'),
    assigneeMembershipId: parseRichContactIdentifier(assigneeMembershipId, 'assigneeMembershipId'),
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function unassignContactCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  assignmentId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.unassignContact(
    scope,
    parseRichContactIdentifier(assignmentId, 'assignmentId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function listCustomFieldDefinitionsCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  includeArchived = false,
) {
  return repository.listCustomFieldDefinitions(validateWorkspaceScope(scopeInput), includeArchived);
}

export async function createCustomFieldDefinitionCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  input: { name?: unknown; type?: unknown; options?: unknown; displayOrder?: unknown },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  requireOwnerScope(scope);
  if (!CUSTOM_FIELD_TYPES.includes(input.type as CustomFieldType)) {
    throw new RichContactError('invalid-input', 'Custom field type is invalid.');
  }
  const type = input.type as CustomFieldType;
  const parsedOptions = options(input.options);
  if (type === 'single-select' && parsedOptions.length === 0) {
    throw new RichContactError('invalid-input', 'Single-select fields require options.');
  }
  if (type !== 'single-select' && parsedOptions.length > 0) {
    throw new RichContactError('invalid-input', 'Only single-select fields accept options.');
  }
  return repository.createCustomFieldDefinition(scope, {
    name: parseRichContactText(input.name, 'name', 80) ?? '',
    type,
    options: parsedOptions,
    displayOrder: integer(input.displayOrder, 'displayOrder'),
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function archiveCustomFieldDefinitionCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  definitionId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  requireOwnerScope(scope);
  return repository.archiveCustomFieldDefinition(
    scope,
    parseRichContactIdentifier(definitionId, 'definitionId'),
    scope.membershipId,
    timestamp(now),
  );
}

export async function listContactCustomFieldValuesCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
) {
  return repository.listCustomFieldValues(
    validateWorkspaceScope(scopeInput),
    parseRichContactIdentifier(contactId, 'contactId'),
  );
}

export async function listContactImportSourceFactsCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
) {
  return repository.listContactImportSourceFacts(
    validateWorkspaceScope(scopeInput),
    parseRichContactIdentifier(contactId, 'contactId'),
  );
}

export async function setContactCustomFieldValueCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  input: { contactId?: unknown; definitionId?: unknown; value?: unknown },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const definitionId = parseRichContactIdentifier(input.definitionId, 'definitionId');
  const definitions = await repository.listCustomFieldDefinitions(scope, true);
  const definition = definitions.find((item) => item.id === definitionId);
  if (!definition) throw new RichContactError('not-found', 'Custom field definition was not found.');
  return repository.setCustomFieldValue(scope, {
    contactId: parseRichContactIdentifier(input.contactId, 'contactId'),
    definitionId,
    value: validateCustomFieldValue(definition, input.value),
    actorMembershipId: scope.membershipId,
    occurredAt: timestamp(now),
  });
}

export async function archiveContactCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
  reason: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.archiveContact(
    scope,
    parseRichContactIdentifier(contactId, 'contactId'),
    scope.membershipId,
    parseRichContactText(reason, 'reason', 240) ?? '',
    timestamp(now),
  );
}

export async function getContactArchiveCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
) {
  return repository.getContactArchive(
    validateWorkspaceScope(scopeInput),
    parseRichContactIdentifier(contactId, 'contactId'),
  );
}

export async function restoreContactCommand(
  repository: RichContactRepository,
  scopeInput: WorkspaceScope,
  contactId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  return repository.restoreContact(
    scope,
    parseRichContactIdentifier(contactId, 'contactId'),
    scope.membershipId,
    timestamp(now),
  );
}
