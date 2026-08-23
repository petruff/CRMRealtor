import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONTACT_POINT_TYPES,
  CONTACT_IMPORT_SOURCE_FACT_CATEGORIES,
  CONTACT_IMPORT_SOURCE_FACT_VALUE_TYPES,
  CUSTOM_FIELD_TYPES,
  PERSON_RELATIONSHIP_KINDS,
  RichContactError,
  type ContactArchiveRecord,
  type ContactAssignment,
  type ContactCustomFieldValue,
  type ContactImportSourceFactRecord,
  type ContactPoint,
  type CustomFieldDefinition,
  type Household,
  type HouseholdMembership,
  type PersonRelationship,
} from '../domain/rich-contact.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { RichContactRepository } from './rich-contact-repository.ts';
import type { ContactIdentityMap } from './contact-identity-map.ts';
import { isMissingSchemaCapability } from './supabase-schema-compat.ts';

interface ContactPointRow {
  id: string; workspace_id: string; contact_id: string; type: string; label: string;
  display_value: string; normalized_value: string; is_primary: boolean;
  email_subscribed: boolean | null; display_order: number; created_at: string; updated_at: string;
  archived_at: string | null; archived_by_membership_id: string | null; archive_reason: string | null;
}
interface HouseholdRow { id: string; workspace_id: string; name: string; created_at: string; updated_at: string; archived_at: string | null; archived_by_membership_id: string | null }
interface HouseholdMembershipRow { id: string; workspace_id: string; household_id: string; contact_id: string; created_at: string; created_by_membership_id: string; ended_at: string | null; ended_by_membership_id: string | null }
interface RelationshipRow { id: string; workspace_id: string; first_contact_id: string; second_contact_id: string; kind: string; label: string | null; created_at: string; created_by_membership_id: string; archived_at: string | null; archived_by_membership_id: string | null }
interface AssignmentRow { id: string; workspace_id: string; contact_id: string; assignee_membership_id: string; assigned_at: string; assigned_by_membership_id: string; unassigned_at: string | null; unassigned_by_membership_id: string | null }
interface DefinitionRow { id: string; workspace_id: string; name: string; type: string; options: string[]; display_order: number; created_at: string; updated_at: string; archived_at: string | null; archived_by_membership_id: string | null }
interface ValueRow { id: string; workspace_id: string; contact_id: string; definition_id: string; text_value: string | null; number_value: number | string | null; date_value: string | null; boolean_value: boolean | null; selected_value: string | null; updated_at: string; updated_by_membership_id: string }
interface SourceFactRow {
  id: string; workspace_id: string; contact_id: string; provider: string; schema_version: string;
  source_key: string; source_label: string; category: string; value_type: string;
  value_json: unknown; value_hash: string; source_row_number: number | null;
  group_idempotency_key: string; request_hash: string; captured_at: string;
}

const LIMIT = 500;

function live(input: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(input);
  if (scope.mode !== 'live') throw new RichContactError('scope-mismatch', 'Supabase rich contacts require live mode.');
  return scope;
}

function failure(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new RichContactError('forbidden', message);
  if (error.code === 'P0002') return new RichContactError('not-found', message);
  if (error.code === '23505') return new RichContactError('conflict', message);
  if (error.code === '23514' || error.code === '22P02') return new RichContactError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function point(row: ContactPointRow): ContactPoint {
  if (!CONTACT_POINT_TYPES.includes(row.type as ContactPoint['type'])) throw new RichContactError('conflict', 'Persistence returned an invalid contact-point type.');
  return { id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id, type: row.type as ContactPoint['type'],
    label: row.label, displayValue: row.display_value, normalizedValue: row.normalized_value,
    isPrimary: row.is_primary, ...(row.email_subscribed === null ? {} : { emailSubscribed: row.email_subscribed }),
    displayOrder: row.display_order, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by_membership_id ? { archivedByMembershipId: row.archived_by_membership_id } : {}),
    ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}) };
}

function household(row: HouseholdRow): Household {
  return { id: row.id, workspaceId: row.workspace_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by_membership_id ? { archivedByMembershipId: row.archived_by_membership_id } : {}) };
}

function membership(row: HouseholdMembershipRow): HouseholdMembership {
  return { id: row.id, workspaceId: row.workspace_id, householdId: row.household_id, contactId: row.contact_id,
    createdAt: row.created_at, createdByMembershipId: row.created_by_membership_id,
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    ...(row.ended_by_membership_id ? { endedByMembershipId: row.ended_by_membership_id } : {}) };
}

function relationship(row: RelationshipRow): PersonRelationship {
  if (!PERSON_RELATIONSHIP_KINDS.includes(row.kind as PersonRelationship['kind'])) throw new RichContactError('conflict', 'Persistence returned an invalid relationship kind.');
  return { id: row.id, workspaceId: row.workspace_id, firstContactId: row.first_contact_id,
    secondContactId: row.second_contact_id, kind: row.kind as PersonRelationship['kind'],
    ...(row.label ? { label: row.label } : {}), createdAt: row.created_at,
    createdByMembershipId: row.created_by_membership_id,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by_membership_id ? { archivedByMembershipId: row.archived_by_membership_id } : {}) };
}

function assignment(row: AssignmentRow): ContactAssignment {
  return { id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id,
    assigneeMembershipId: row.assignee_membership_id, assignedAt: row.assigned_at,
    assignedByMembershipId: row.assigned_by_membership_id,
    ...(row.unassigned_at ? { unassignedAt: row.unassigned_at } : {}),
    ...(row.unassigned_by_membership_id ? { unassignedByMembershipId: row.unassigned_by_membership_id } : {}) };
}

function definition(row: DefinitionRow): CustomFieldDefinition {
  if (!CUSTOM_FIELD_TYPES.includes(row.type as CustomFieldDefinition['type'])) throw new RichContactError('conflict', 'Persistence returned an invalid custom-field type.');
  return { id: row.id, workspaceId: row.workspace_id, name: row.name,
    type: row.type as CustomFieldDefinition['type'], options: row.options,
    displayOrder: row.display_order, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by_membership_id ? { archivedByMembershipId: row.archived_by_membership_id } : {}) };
}

function customValue(row: ValueRow): ContactCustomFieldValue {
  const raw = row.text_value ?? row.date_value ?? row.selected_value ?? row.boolean_value ?? row.number_value;
  if (raw === null) throw new RichContactError('conflict', 'Persistence returned an empty custom-field value.');
  const value = typeof raw === 'string' && row.number_value !== null ? Number(raw) : raw;
  return { id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id,
    definitionId: row.definition_id, value, updatedAt: row.updated_at,
    updatedByMembershipId: row.updated_by_membership_id };
}

function sourceFact(row: SourceFactRow): ContactImportSourceFactRecord {
  if (!CONTACT_IMPORT_SOURCE_FACT_CATEGORIES.includes(row.category as ContactImportSourceFactRecord['category'])
    || !CONTACT_IMPORT_SOURCE_FACT_VALUE_TYPES.includes(row.value_type as ContactImportSourceFactRecord['valueType'])
    || !['string', 'number', 'boolean'].includes(typeof row.value_json)) {
    throw new RichContactError('conflict', 'Persistence returned an invalid import source fact.');
  }
  return {
    id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id,
    provider: row.provider, schemaVersion: row.schema_version, key: row.source_key,
    label: row.source_label, category: row.category as ContactImportSourceFactRecord['category'],
    valueType: row.value_type as ContactImportSourceFactRecord['valueType'],
    value: row.value_json as string | number | boolean, valueHash: row.value_hash,
    ...(row.source_row_number === null ? {} : { sourceRowNumber: row.source_row_number }),
    groupIdempotencyKey: row.group_idempotency_key, requestHash: row.request_hash,
    capturedAt: row.captured_at,
  };
}

function archiveRecord(value: unknown): ContactArchiveRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RichContactError('conflict', 'Persistence returned an invalid contact lifecycle receipt.');
  const row = value as Record<string, unknown>;
  if (typeof row.contactId !== 'string' || typeof row.workspaceId !== 'string') throw new RichContactError('conflict', 'Persistence returned an invalid contact lifecycle receipt.');
  return { contactId: row.contactId, workspaceId: row.workspaceId,
    ...(typeof row.archivedAt === 'string' ? { archivedAt: row.archivedAt } : {}),
    ...(typeof row.archivedByMembershipId === 'string' ? { archivedByMembershipId: row.archivedByMembershipId } : {}),
    ...(typeof row.archiveReason === 'string' ? { archiveReason: row.archiveReason } : {}) };
}

export function supabaseRichContactRepository(
  supabase: SupabaseClient,
  identityMap?: ContactIdentityMap,
): RichContactRepository {
  async function rpc<T>(name: string, args: Record<string, unknown>, map: (row: never) => T): Promise<T> {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw failure(`Failed to execute ${name}`, error);
    if (!data) throw new RichContactError('conflict', `${name} returned no record.`);
    return map(data as never);
  }
  async function canonical(scope: WorkspaceScope, contactId: string): Promise<string> {
    return identityMap ? identityMap.resolveCanonical(scope, contactId) : contactId;
  }
  async function members(scope: WorkspaceScope, contactId: string): Promise<readonly string[]> {
    return identityMap
      ? (await identityMap.listGroupMembers(scope, contactId)).memberContactIds
      : [contactId];
  }
  return {
    async listContactPoints(input, contactId, includeArchived) {
      const scope = live(input);
      let query = supabase.from('contact_points').select('*').eq('workspace_id', scope.workspaceId);
      query = identityMap
        ? query.in('contact_id', [...await members(scope, contactId)])
        : query.eq('contact_id', contactId);
      if (!includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query.order('display_order').order('created_at').order('id').limit(LIMIT);
      if (error) throw failure('Failed to list contact points', error);
      return ((data ?? []) as ContactPointRow[]).map(point);
    },
    async listContactPointsForContacts(input, contactIds, includeArchived) {
      const scope = live(input);
      const unique = [...new Set(contactIds)];
      if (unique.length === 0) return [];
      if (unique.length > LIMIT) {
        throw new RichContactError('invalid-input', `Contact-point batch cannot exceed ${LIMIT} contacts.`);
      }
      let query = supabase.from('contact_points').select('*')
        .eq('workspace_id', scope.workspaceId)
        .in('contact_id', unique);
      if (!includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query.order('contact_id').order('display_order')
        .order('created_at').order('id').limit(LIMIT * 4);
      if (error) throw failure('Failed to list contact points for audit', error);
      return ((data ?? []) as ContactPointRow[]).map(point);
    },
    async addContactPoint(input, value) {
      const scope = live(input);
      return rpc('add_contact_point', { target_contact_id: await canonical(scope, value.contactId), target_type: value.type,
        target_label: value.label, target_display_value: value.displayValue, target_normalized_value: value.normalizedValue,
        target_is_primary: value.isPrimary, target_email_subscribed: value.emailSubscribed ?? null,
        target_display_order: value.displayOrder, target_actor_membership_id: value.actorMembershipId,
        target_occurred_at: value.occurredAt }, point);
    },
    async updateContactPoint(input, pointId, value) {
      live(input);
      return rpc('update_contact_point', { target_point_id: pointId, target_label: value.label,
        target_display_value: value.displayValue, target_normalized_value: value.normalizedValue,
        target_is_primary: value.isPrimary, target_email_subscribed: value.emailSubscribed ?? null,
        target_display_order: value.displayOrder, target_actor_membership_id: value.actorMembershipId,
        target_occurred_at: value.occurredAt }, point);
    },
    async archiveContactPoint(input, pointId, actorId, reason, occurredAt) {
      live(input); return rpc('archive_contact_point', { target_point_id: pointId, target_actor_membership_id: actorId,
        target_reason: reason, target_occurred_at: occurredAt }, point);
    },
    async restoreContactPoint(input, pointId, actorId, occurredAt) {
      live(input); return rpc('restore_contact_point', { target_point_id: pointId, target_actor_membership_id: actorId,
        target_occurred_at: occurredAt }, point);
    },
    async listHouseholds(input, includeArchived) {
      const scope = live(input); let query = supabase.from('households').select('*').eq('workspace_id', scope.workspaceId);
      if (!includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query.order('name').order('id').limit(LIMIT);
      if (error) throw failure('Failed to list households', error);
      return ((data ?? []) as HouseholdRow[]).map(household);
    },
    async createHousehold(input, value) {
      live(input); return rpc('create_household', { target_name: value.name,
        target_actor_membership_id: value.actorMembershipId, target_occurred_at: value.occurredAt }, household);
    },
    async archiveHousehold(input, householdId, actorId, occurredAt) {
      live(input); return rpc('archive_household', { target_household_id: householdId,
        target_actor_membership_id: actorId, target_occurred_at: occurredAt }, household);
    },
    async listHouseholdMembers(input, householdId) {
      const scope = live(input); const { data, error } = await supabase.from('household_memberships').select('*')
        .eq('workspace_id', scope.workspaceId).eq('household_id', householdId).is('ended_at', null)
        .order('created_at').order('id').limit(LIMIT);
      if (error) throw failure('Failed to list household members', error);
      return ((data ?? []) as HouseholdMembershipRow[]).map(membership);
    },
    async addHouseholdMember(input, value) {
      const scope = live(input); return rpc('add_household_member', { target_household_id: value.householdId,
        target_contact_id: await canonical(scope, value.contactId), target_actor_membership_id: value.actorMembershipId,
        target_occurred_at: value.occurredAt }, membership);
    },
    async removeHouseholdMember(input, householdId, contactId, actorId, occurredAt) {
      const scope = live(input); const { error } = await supabase.rpc('remove_household_member', { target_household_id: householdId,
        target_contact_id: await canonical(scope, contactId), target_actor_membership_id: actorId, target_occurred_at: occurredAt });
      if (error) throw failure('Failed to remove household member', error);
    },
    async listRelationships(input, contactId, includeArchived) {
      const scope = live(input); let query = supabase.from('contact_relationships').select('*').eq('workspace_id', scope.workspaceId);
      if (contactId) {
        const ids = await members(scope, contactId);
        query = query.or(`first_contact_id.in.(${ids.join(',')}),second_contact_id.in.(${ids.join(',')})`);
      }
      if (!includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query.order('created_at').order('id').limit(LIMIT);
      if (error) throw failure('Failed to list contact relationships', error);
      return ((data ?? []) as RelationshipRow[]).map(relationship);
    },
    async addRelationship(input, value) {
      const scope = live(input); return rpc('add_contact_relationship', {
        target_first_contact_id: await canonical(scope, value.firstContactId),
        target_second_contact_id: await canonical(scope, value.secondContactId), target_kind: value.kind, target_label: value.label ?? null,
        target_actor_membership_id: value.actorMembershipId, target_occurred_at: value.occurredAt }, relationship);
    },
    async archiveRelationship(input, relationshipId, actorId, occurredAt) {
      live(input); return rpc('archive_contact_relationship', { target_relationship_id: relationshipId,
        target_actor_membership_id: actorId, target_occurred_at: occurredAt }, relationship);
    },
    async restoreRelationship(input, relationshipId, actorId, occurredAt) {
      live(input); return rpc('restore_contact_relationship', { target_relationship_id: relationshipId,
        target_actor_membership_id: actorId, target_occurred_at: occurredAt }, relationship);
    },
    async listAssignments(input, contactId, includeUnassigned) {
      const scope = live(input); let query = supabase.from('contact_assignments').select('*').eq('workspace_id', scope.workspaceId);
      if (contactId) query = identityMap
        ? query.in('contact_id', [...await members(scope, contactId)])
        : query.eq('contact_id', contactId);
      if (!includeUnassigned) query = query.is('unassigned_at', null);
      const { data, error } = await query.order('assigned_at', { ascending: false }).order('id').limit(LIMIT);
      if (error) throw failure('Failed to list contact assignments', error);
      return ((data ?? []) as AssignmentRow[]).map(assignment);
    },
    async assignContact(input, value) {
      const scope = live(input); return rpc('assign_contact', { target_contact_id: await canonical(scope, value.contactId),
        target_assignee_membership_id: value.assigneeMembershipId, target_actor_membership_id: value.actorMembershipId,
        target_occurred_at: value.occurredAt }, assignment);
    },
    async unassignContact(input, assignmentId, actorId, occurredAt) {
      live(input); return rpc('unassign_contact', { target_assignment_id: assignmentId,
        target_actor_membership_id: actorId, target_occurred_at: occurredAt }, assignment);
    },
    async listCustomFieldDefinitions(input, includeArchived) {
      const scope = live(input); let query = supabase.from('contact_custom_field_definitions').select('*').eq('workspace_id', scope.workspaceId);
      if (!includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query.order('display_order').order('name').order('id').limit(LIMIT);
      if (error) throw failure('Failed to list custom-field definitions', error);
      return ((data ?? []) as DefinitionRow[]).map(definition);
    },
    async createCustomFieldDefinition(input, value) {
      live(input); return rpc('create_contact_custom_field_definition', { target_name: value.name, target_type: value.type,
        target_options: value.options, target_display_order: value.displayOrder,
        target_actor_membership_id: value.actorMembershipId, target_occurred_at: value.occurredAt }, definition);
    },
    async archiveCustomFieldDefinition(input, definitionId, actorId, occurredAt) {
      live(input); return rpc('archive_contact_custom_field_definition', { target_definition_id: definitionId,
        target_actor_membership_id: actorId, target_occurred_at: occurredAt }, definition);
    },
    async listCustomFieldValues(input, contactId) {
      const scope = live(input); let query = supabase.from('contact_custom_field_values').select('*')
        .eq('workspace_id', scope.workspaceId);
      query = identityMap
        ? query.in('contact_id', [...await members(scope, contactId)])
        : query.eq('contact_id', contactId);
      const { data, error } = await query.order('definition_id').limit(LIMIT);
      if (error) throw failure('Failed to list custom-field values', error);
      return ((data ?? []) as ValueRow[]).map(customValue);
    },
    async setCustomFieldValue(input, value) {
      const scope = live(input); return rpc('set_contact_custom_field_value', { target_contact_id: await canonical(scope, value.contactId),
        target_definition_id: value.definitionId, target_value: value.value,
        target_actor_membership_id: value.actorMembershipId, target_occurred_at: value.occurredAt }, customValue);
    },
    async listContactImportSourceFacts(input, contactId) {
      const scope = live(input);
      let query = supabase.from('contact_import_source_facts')
        .select('id, workspace_id, contact_id, provider, schema_version, source_key, source_label, category, value_type, value_json, value_hash, source_row_number, group_idempotency_key, request_hash, captured_at')
        .eq('workspace_id', scope.workspaceId);
      query = identityMap
        ? query.in('contact_id', [...await members(scope, contactId)])
        : query.eq('contact_id', contactId);
      const { data, error } = await query.order('captured_at', { ascending: false }).order('category').order('source_label').limit(LIMIT);
      if (error && isMissingSchemaCapability(error, ['contact_import_source_facts'])) return [];
      if (error) throw failure('Failed to list import source facts', error);
      return ((data ?? []) as SourceFactRow[]).map(sourceFact);
    },
    async getContactArchive(input, contactId) {
      const scope = live(input); const canonicalId = await canonical(scope, contactId);
      const { data, error } = await supabase.from('contacts')
        .select('id, workspace_id, archived_at, archived_by_membership_id, archive_reason')
        .eq('workspace_id', scope.workspaceId).eq('id', canonicalId).maybeSingle();
      if (error) throw failure('Failed to read contact lifecycle', error);
      if (!data) return undefined;
      const row = data as { id: string; workspace_id: string; archived_at: string | null; archived_by_membership_id: string | null; archive_reason: string | null };
      return { contactId: row.id, workspaceId: row.workspace_id,
        ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
        ...(row.archived_by_membership_id ? { archivedByMembershipId: row.archived_by_membership_id } : {}),
        ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}) };
    },
    async archiveContact(input, contactId, actorId, reason, occurredAt) {
      const scope = live(input); const canonicalId = await canonical(scope, contactId);
      if (canonicalId !== contactId) throw new RichContactError('conflict', 'An aliased donor cannot be archived directly.');
      return rpc('archive_contact', { target_contact_id: canonicalId,
        target_actor_membership_id: actorId, target_reason: reason, target_occurred_at: occurredAt }, archiveRecord);
    },
    async restoreContact(input, contactId, actorId, occurredAt) {
      const scope = live(input); const canonicalId = await canonical(scope, contactId);
      if (canonicalId !== contactId) throw new RichContactError('conflict', 'An aliased donor cannot be restored directly.');
      return rpc('restore_contact', { target_contact_id: canonicalId,
        target_actor_membership_id: actorId, target_occurred_at: occurredAt }, archiveRecord);
    },
  };
}
