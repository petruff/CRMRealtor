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
import {
  NoteEditError,
  type BuyerCriteria,
  type Contact,
  type Intent,
  type LeadSource,
  type LeadType,
  type Note,
  type PipelineStage,
  type QualificationStatus,
  type Relationship,
  type SellerCriteria,
} from '../domain/contact.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ContactIdentityMap } from './contact-identity-map.ts';
import type {
  ContactPage,
  ContactPageRequest,
  ContactPageScope,
  ContactRepository,
} from './repository.ts';

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
  /** Added by 20260923120000_editable_contact_notes; absent on older schemas. */
  revision?: number | null;
  updated_at?: string | null;
  edited_by_membership_id?: string | null;
}

const NOTE_COLUMNS = 'id, contact_id, body, created_at, archived_at, archived_by_membership_id, archive_reason';
const NOTE_EDIT_COLUMNS = `${NOTE_COLUMNS}, revision, updated_at, edited_by_membership_id`;

/** An application release may briefly precede the additive note-edit migration. */
function missingNoteEditColumns(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '42703' && /revision|updated_at|edited_by_membership_id/u.test(error.message ?? '');
}

function noteFromRow(row: NoteRow): Note {
  return {
    id: row.id,
    contactId: row.contact_id,
    body: row.body,
    createdAt: row.created_at,
    revision: row.revision ?? 1,
    updatedAt: undef(row.updated_at ?? null),
    editedByMembershipId: undef(row.edited_by_membership_id ?? null),
    archivedAt: undef(row.archived_at),
    archivedByMembershipId: undef(row.archived_by_membership_id),
    archiveReason: undef(row.archive_reason),
  };
}

function noteEditFailure(error: { code?: string; message?: string }): Error {
  if (error.code === '40001') return new NoteEditError('conflict', 'This note was changed in another session.');
  if (error.code === '55000') return new NoteEditError('read-only', 'Archived notes and contacts are read only.');
  if (error.code === 'P0002') return new NoteEditError('not-found', 'Note not found.');
  if (error.code === '42883' || error.code === 'PGRST202') {
    return new NoteEditError('read-only', 'Note editing is not enabled in this workspace yet.');
  }
  return new Error(`Failed to edit note: ${error.message ?? 'unknown error'}`);
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
const CONTACT_READ_PAGE_SIZE = 500;

function exactNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Failed to load contact page: ${label} is invalid.`);
  }
  return value as number;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Failed to load contact page: ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function legacyPageScope(request: ContactPageRequest): ContactPageScope {
  if (request.scope) return request.scope;
  if (request.qualificationStatus === 'needs-qualification') return 'needs-review';
  const relationships = request.relationships ?? [];
  if (relationships.length === 0) return 'all';
  const key = [...relationships].sort().join(',');
  if (key === 'lead,sphere') return 'leads';
  if (key === 'active-client,past-client') return 'clients';
  if (key === 'active-client') return 'active-clients';
  if (key === 'past-client') return 'past-clients';
  throw new Error('Failed to load contact page: relationship scope is unsupported.');
}

function contactPageFromRpc(data: unknown): ContactPage {
  const result = objectValue(data, 'RPC response');
  if (!Array.isArray(result.items)) {
    throw new Error('Failed to load contact page: items are invalid.');
  }
  const scopeCounts = objectValue(result.scopeCounts, 'scope counts');
  const leadTypeCounts = objectValue(result.leadTypeCounts, 'lead type counts');
  return {
    items: result.items.map((row) => contactFromRow(objectValue(row, 'contact row') as unknown as ContactRow)),
    total: exactNonNegativeInteger(result.total, 'total'),
    activeTotal: exactNonNegativeInteger(result.activeTotal, 'active total'),
    scopeCounts: {
      leads: exactNonNegativeInteger(scopeCounts.leads, 'leads count'),
      clients: exactNonNegativeInteger(scopeCounts.clients, 'clients count'),
      'active-clients': exactNonNegativeInteger(scopeCounts['active-clients'], 'active clients count'),
      'past-clients': exactNonNegativeInteger(scopeCounts['past-clients'], 'past clients count'),
      'needs-review': exactNonNegativeInteger(scopeCounts['needs-review'], 'needs review count'),
      all: exactNonNegativeInteger(scopeCounts.all, 'all contacts count'),
    },
    leadTypeCounts: {
      hot: exactNonNegativeInteger(leadTypeCounts.hot, 'hot count'),
      warm: exactNonNegativeInteger(leadTypeCounts.warm, 'warm count'),
      nurture: exactNonNegativeInteger(leadTypeCounts.nurture, 'nurture count'),
    },
    offset: exactNonNegativeInteger(result.offset, 'offset'),
    limit: exactNonNegativeInteger(result.limit, 'limit'),
    aliasEpoch: exactNonNegativeInteger(result.aliasEpoch, 'alias epoch'),
  };
}

export function supabaseRepository(
  supabase: SupabaseClient,
  untrustedScope: WorkspaceScope,
  identityMap?: ContactIdentityMap,
): ContactRepository {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') throw new Error('Supabase repositories require a live workspace scope.');

  async function listAll(options?: Parameters<ContactRepository['list']>[0]): Promise<Contact[]> {
    const rows: ContactRow[] = [];
    let offset = 0;
    let exactRowCount: number | undefined;
    while (exactRowCount === undefined || rows.length < exactRowCount) {
      let query = supabase
        .from('contacts')
        .select(CONTACT_COLUMNS, { count: 'exact' })
        .eq('workspace_id', scope.workspaceId);
      if (options?.archivedOnly) query = query.not('archived_at', 'is', null);
      else if (!options?.includeArchived) query = query.is('archived_at', null);
      if (options?.relationships?.length) query = query.in('relationship', [...options.relationships]);
      if (options?.qualificationStatus) query = query.eq('qualification_status', options.qualificationStatus);
      if (options?.leadType) query = query.eq('lead_type', options.leadType);
      const { data, error, count } = await query
        .order('next_touch_at', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(offset, offset + CONTACT_READ_PAGE_SIZE - 1);

      if (error) throw new Error(`Failed to load contacts: ${error.message}`);
      if (typeof count !== 'number') throw new Error('Failed to load contacts: exact count was unavailable.');
      if (exactRowCount !== undefined && count !== exactRowCount) {
        throw new Error('Failed to load contacts: the exact count changed during pagination.');
      }
      exactRowCount = count;
      const page = (data ?? []) as ContactRow[];
      if (page.length === 0 && rows.length < exactRowCount) {
        throw new Error('Failed to load contacts: the paginated read ended before the exact count.');
      }
      rows.push(...page);
      offset += page.length;
    }
    if (new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new Error('Failed to load contacts: pagination returned duplicate records.');
    }
    const contacts = rows.map(contactFromRow);
    if (!identityMap || contacts.length === 0) return contacts;
    const aliases = await identityMap.resolvePage(scope, contacts.map((contact) => contact.id));
    return contacts.filter((contact) => aliases.get(contact.id) === contact.id);
  }

  return {
    list: listAll,

    async listPage(request) {
      const { offset, limit } = request;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('Contact page requires an offset of 0 or greater and a limit from 1 to 100.');
      }
      if (request.includeArchived && !request.archivedOnly) {
        throw new Error('Contact pages cannot combine active and archived records.');
      }
      const { data, error } = await supabase.rpc('list_canonical_contact_page', {
        target_workspace_id: scope.workspaceId,
        target_scope: legacyPageScope(request),
        target_query: request.query ?? '',
        target_lead_type: request.leadType ?? null,
        target_source: request.source ?? null,
        target_smart_list_id: request.smartListId ?? null,
        target_archived_only: request.archivedOnly === true,
        target_offset: offset,
        target_limit: limit,
      });
      if (error) throw new Error(`Failed to load contact page: ${error.message}`);
      const page = contactPageFromRpc(data);
      if (page.offset !== offset || page.limit !== limit) {
        throw new Error('Failed to load contact page: RPC bounds do not match the request.');
      }
      return page;
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
      const read = async (columns: string) => {
        let query = supabase
          .from('notes')
          .select(columns)
          .eq('workspace_id', scope.workspaceId);
        query = group
          ? query.in('contact_id', [...group.memberContactIds])
          : query.eq('contact_id', contactId);
        if (options?.archivedOnly) query = query.not('archived_at', 'is', null);
        else if (!options?.includeArchived) query = query.is('archived_at', null);
        // Ordered by creation, so an edited note keeps its chronological place.
        return query.order('created_at', { ascending: false });
      };
      let { data, error } = await read(NOTE_EDIT_COLUMNS);
      if (missingNoteEditColumns(error)) ({ data, error } = await read(NOTE_COLUMNS));

      if (error) throw new Error(`Failed to load notes: ${error.message}`);
      return (data as unknown as NoteRow[]).map(noteFromRow);
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

    async editNote({ noteId, body, expectedRevision, correlationId, occurredAt }) {
      const { data, error } = await supabase.rpc('edit_contact_note', {
        target_note_id: noteId,
        target_expected_revision: expectedRevision,
        target_body: body,
        target_correlation_id: correlationId,
        target_occurred_at: occurredAt ?? new Date().toISOString(),
      });
      if (error) throw noteEditFailure(error);
      const result = data as {
        noteId: string; contactId: string; body: string; createdAt: string; revision: number;
        updatedAt: string | null; editedByMembershipId: string | null; noOp: boolean;
      };
      return {
        noOp: Boolean(result.noOp),
        note: {
          id: result.noteId,
          contactId: result.contactId,
          body: result.body,
          createdAt: result.createdAt,
          revision: result.revision,
          ...(result.updatedAt ? { updatedAt: result.updatedAt } : {}),
          ...(result.editedByMembershipId ? { editedByMembershipId: result.editedByMembershipId } : {}),
        },
      };
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
