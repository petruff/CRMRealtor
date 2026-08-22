/**
 * Supabase implementation of ContactRepository.
 *
 * Row shape mirrors `supabase/migrations/0001_init.sql`. Mapping is explicit in
 * both directions rather than generated, because the snake_case/camelCase seam is
 * exactly where silent data loss happens — a mistyped key becomes `undefined`
 * instead of a compile error.
 *
 * `workspace_id` is the canonical tenant authority. `owner_id` remains filled
 * only for the migration compatibility window and never grants access.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BuyerCriteria,
  Contact,
  Intent,
  LeadSource,
  LeadType,
  Note,
  PipelineStage,
  QualificationStatus,
  Relationship,
  SellerCriteria,
} from '../domain/contact.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ContactIdentityMap } from './contact-identity-map.ts';
import type { ContactRepository } from './repository.ts';

export interface ContactRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  mailing_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  birthdate: string | null;
  home_purchase_date: string | null;
  lead_type: LeadType;
  qualification_status: QualificationStatus;
  relationship: Relationship;
  intent: Intent;
  source: LeadSource;
  pipeline_stage: PipelineStage;
  buyer_criteria: BuyerCriteria | null;
  seller_criteria: SellerCriteria | null;
  referred_by_id: string | null;
  last_contacted_at: string | null;
  next_touch_at: string | null;
  touch_date_overridden: boolean;
  tags: string[] | null;
  email_subscribed: boolean;
  archived_at: string | null;
  archived_by_membership_id: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  contact_id: string;
  body: string;
  created_at: string;
  archived_at: string | null;
  archived_by_membership_id: string | null;
  archive_reason: string | null;
}

/** Drop nulls so optional domain fields stay genuinely absent, not `null`. */
function undef<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

export function contactFromRow(row: ContactRow): Contact {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: undef(row.preferred_name),
    phone: undef(row.phone),
    secondaryPhone: undef(row.secondary_phone),
    email: undef(row.email),
    mailingAddress: undef(row.mailing_address),
    city: undef(row.city),
    state: undef(row.state),
    postalCode: undef(row.postal_code),
    birthdate: undef(row.birthdate),
    homePurchaseDate: undef(row.home_purchase_date),
    leadType: row.lead_type,
    qualificationStatus: row.qualification_status ?? 'qualified',
    relationship: row.relationship,
    intent: row.intent,
    source: row.source,
    pipelineStage: row.pipeline_stage,
    buyer: undef(row.buyer_criteria),
    seller: undef(row.seller_criteria),
    referredById: undef(row.referred_by_id),
    lastContactedAt: undef(row.last_contacted_at),
    nextTouchAt: undef(row.next_touch_at),
    touchDateOverridden: row.touch_date_overridden,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    emailSubscribed: row.email_subscribed,
    archivedAt: undef(row.archived_at),
    archivedByMembershipId: undef(row.archived_by_membership_id),
    archiveReason: undef(row.archive_reason),
  };
}

/** Only maps keys present on the patch, so a partial update stays partial. */
function toRow(patch: Partial<Contact>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const has = (key: keyof Contact) => Object.prototype.hasOwnProperty.call(patch, key);
  const set = (domainKey: keyof Contact, rowKey: string) => {
    if (has(domainKey)) row[rowKey] = patch[domainKey];
  };
  const setNullable = (domainKey: keyof Contact, rowKey: string) => {
    if (has(domainKey)) row[rowKey] = patch[domainKey] ?? null;
  };

  set('firstName', 'first_name');
  set('lastName', 'last_name');
  setNullable('preferredName', 'preferred_name');
  setNullable('phone', 'phone');
  setNullable('secondaryPhone', 'secondary_phone');
  setNullable('email', 'email');
  setNullable('mailingAddress', 'mailing_address');
  setNullable('city', 'city');
  setNullable('state', 'state');
  setNullable('postalCode', 'postal_code');
  setNullable('birthdate', 'birthdate');
  setNullable('homePurchaseDate', 'home_purchase_date');
  set('leadType', 'lead_type');
  set('qualificationStatus', 'qualification_status');
  set('relationship', 'relationship');
  set('intent', 'intent');
  set('source', 'source');
  set('pipelineStage', 'pipeline_stage');
  setNullable('buyer', 'buyer_criteria');
  setNullable('seller', 'seller_criteria');
  setNullable('referredById', 'referred_by_id');
  setNullable('lastContactedAt', 'last_contacted_at');
  setNullable('nextTouchAt', 'next_touch_at');
  set('touchDateOverridden', 'touch_date_overridden');
  set('tags', 'tags');
  set('emailSubscribed', 'email_subscribed');
  setNullable('archivedAt', 'archived_at');
  setNullable('archivedByMembershipId', 'archived_by_membership_id');
  setNullable('archiveReason', 'archive_reason');

  return row;
}

export const CONTACT_COLUMNS = '*';

export function supabaseRepository(
  supabase: SupabaseClient,
  untrustedScope: WorkspaceScope,
  identityMap?: ContactIdentityMap,
): ContactRepository {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') throw new Error('Supabase repositories require a live workspace scope.');

  return {
    async list(options) {
      let query = supabase
        .from('contacts')
        .select(CONTACT_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (options?.archivedOnly) query = query.not('archived_at', 'is', null);
      else if (!options?.includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query
        .order('next_touch_at', { ascending: true, nullsFirst: true })
        .limit(500);

      if (error) throw new Error(`Failed to load contacts: ${error.message}`);
      const contacts = (data as ContactRow[]).map(contactFromRow);
      if (!identityMap || contacts.length === 0) return contacts;
      const aliases = await identityMap.resolvePage(scope, contacts.map((contact) => contact.id));
      return contacts.filter((contact) => aliases.get(contact.id) === contact.id);
    },

    async get(id) {
      const canonicalId = identityMap ? await identityMap.resolveCanonical(scope, id) : id;
      const { data, error } = await supabase
        .from('contacts')
        .select(CONTACT_COLUMNS)
        .eq('id', canonicalId)
        .eq('workspace_id', scope.workspaceId)
        .maybeSingle();

      if (error) throw new Error(`Failed to load contact ${id}: ${error.message}`);
      return data ? contactFromRow(data as ContactRow) : undefined;
    },

    async create(input) {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          ...toRow(input),
          workspace_id: scope.workspaceId,
          owner_id: scope.ownerUserId,
        })
        .select(CONTACT_COLUMNS)
        .single();

      if (error) throw new Error(`Failed to create contact: ${error.message}`);
      return contactFromRow(data as ContactRow);
    },

    async update(id, patch) {
      const canonicalId = identityMap ? await identityMap.resolveCanonical(scope, id) : id;
      const { data, error } = await supabase
        .from('contacts')
        .update(toRow(patch))
        .eq('id', canonicalId)
        .eq('workspace_id', scope.workspaceId)
        .select(CONTACT_COLUMNS)
        .single();

      if (error) throw new Error(`Failed to update contact ${id}: ${error.message}`);
      return contactFromRow(data as ContactRow);
    },

    async remove(id) {
      void id;
      throw new Error('Permanent contact deletion is unavailable. Use the archive lifecycle.');
    },

    async notesFor(contactId, options) {
      const group = identityMap ? await identityMap.listGroupMembers(scope, contactId) : undefined;
      let query = supabase
        .from('notes')
        .select('id, contact_id, body, created_at, archived_at, archived_by_membership_id, archive_reason')
        .eq('workspace_id', scope.workspaceId);
      query = group
        ? query.in('contact_id', [...group.memberContactIds])
        : query.eq('contact_id', contactId);
      if (options?.archivedOnly) query = query.not('archived_at', 'is', null);
      else if (!options?.includeArchived) query = query.is('archived_at', null);
      const { data, error } = await query
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to load notes: ${error.message}`);
      return (data as NoteRow[]).map(
        (row): Note => ({
          id: row.id,
          contactId: row.contact_id,
          body: row.body,
          createdAt: row.created_at,
          archivedAt: undef(row.archived_at),
          archivedByMembershipId: undef(row.archived_by_membership_id),
          archiveReason: undef(row.archive_reason),
        }),
      );
    },

    async addNote(contactId, body) {
      const canonicalId = identityMap ? await identityMap.resolveCanonical(scope, contactId) : contactId;
      const { data, error } = await supabase
        .from('notes')
        .insert({
          contact_id: canonicalId,
          body,
          workspace_id: scope.workspaceId,
          owner_id: scope.ownerUserId,
        })
        .select('id, contact_id, body, created_at, archived_at, archived_by_membership_id, archive_reason')
        .single();

      if (error) throw new Error(`Failed to add note: ${error.message}`);
      const row = data as NoteRow;
      return { id: row.id, contactId: row.contact_id, body: row.body, createdAt: row.created_at };
    },

    async archiveNote(noteId, reason, correlationId, occurredAt) {
      const { data, error } = await supabase.rpc('archive_contact_note', {
        target_note_id: noteId, target_reason: reason, target_correlation_id: correlationId,
        target_occurred_at: occurredAt ?? new Date().toISOString(),
      });
      if (error) throw new Error(`Failed to archive note: ${error.message}`);
      return { noOp: Boolean((data as { noOp?: unknown } | null)?.noOp) };
    },

    async restoreNote(noteId, correlationId, occurredAt) {
      const { data, error } = await supabase.rpc('restore_contact_note', {
        target_note_id: noteId, target_correlation_id: correlationId,
        target_occurred_at: occurredAt ?? new Date().toISOString(),
      });
      if (error) throw new Error(`Failed to restore note: ${error.message}`);
      return { noOp: Boolean((data as { noOp?: unknown } | null)?.noOp) };
    },
  };
}
