import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '../domain/contact.ts';
import {
  hasSafeIdentity,
  IncompleteRecordError,
  projectIncompleteCandidate,
  type IncompleteCandidate,
  type IncompleteContactConversionPlan,
  type IncompleteConversionAction,
  type IncompleteConversionReceipt,
  type IncompleteRecord,
  type IncompleteRecordStatus,
} from '../domain/incomplete-record.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { IncompleteRecordRepository } from './incomplete-record-repository.ts';
import { supabaseRepository } from './supabase-repository.ts';

interface IncompleteRecordRow {
  id: string;
  workspace_id: string;
  source: string;
  external_id: string | null;
  candidate: unknown;
  validation_reasons: unknown;
  status: IncompleteRecordStatus;
  intake_idempotency_key: string | null;
  converted_contact_id: string | null;
  conversion_action: IncompleteConversionAction | null;
  conversion_idempotency_key: string | null;
  converted_at: string | null;
  converted_by_membership_id: string | null;
  archived_at: string | null;
  archived_by_membership_id: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversionEnvelope {
  record: unknown;
  contactId: unknown;
  action: unknown;
  noOp: unknown;
}

const INCOMPLETE_COLUMNS = [
  'id', 'workspace_id', 'source', 'external_id', 'candidate', 'validation_reasons',
  'status', 'intake_idempotency_key', 'converted_contact_id', 'conversion_action',
  'conversion_idempotency_key', 'converted_at', 'converted_by_membership_id',
  'archived_at', 'archived_by_membership_id', 'archive_reason', 'created_at', 'updated_at',
].join(', ');
const INCOMPLETE_FETCH_LIMIT = 500;
const INCOMPLETE_QUERY_MAX = 200;

function liveScope(untrustedScope: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') {
    throw new IncompleteRecordError('scope-mismatch', 'Supabase incomplete records require live mode.');
  }
  return scope;
}

function persistenceError(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new IncompleteRecordError('forbidden', message);
  if (error.code === '23505') return new IncompleteRecordError('conflict', message);
  if (error.code === '23514') return new IncompleteRecordError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function toRecord(row: IncompleteRecordRow): IncompleteRecord {
  if (row.status !== 'pending' && row.status !== 'converted' && row.status !== 'archived') {
    throw new IncompleteRecordError('conflict', 'Persistence returned an invalid incomplete status.');
  }
  if (
    row.conversion_action !== null
    && row.conversion_action !== 'create'
    && row.conversion_action !== 'update'
    && row.conversion_action !== 'unchanged'
  ) {
    throw new IncompleteRecordError('conflict', 'Persistence returned an invalid conversion action.');
  }
  const projected = projectIncompleteCandidate(
    row.candidate,
    row.validation_reasons,
    row.external_id ?? undefined,
  );
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    source: row.source,
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.intake_idempotency_key ? { intakeIdempotencyKey: row.intake_idempotency_key } : {}),
    candidate: projected.candidate,
    reasons: projected.reasons,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.converted_contact_id ? { convertedContactId: row.converted_contact_id } : {}),
    ...(row.conversion_action ? { conversionAction: row.conversion_action } : {}),
    ...(row.conversion_idempotency_key
      ? { conversionIdempotencyKey: row.conversion_idempotency_key }
      : {}),
    ...(row.converted_at ? { convertedAt: row.converted_at } : {}),
    ...(row.converted_by_membership_id
      ? { convertedByMembershipId: row.converted_by_membership_id }
      : {}),
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by_membership_id
      ? { archivedByMembershipId: row.archived_by_membership_id }
      : {}),
    ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}),
  };
}

function normalizeEmail(value?: string): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function normalizePhone(value?: string): string | undefined {
  return value?.replace(/\D/g, '') || undefined;
}

function contactInput(candidate: IncompleteCandidate): Omit<Contact, 'id' | 'createdAt'> {
  if (!candidate.firstName && !candidate.lastName) {
    throw new IncompleteRecordError(
      'invalid-input',
      'Correct the candidate to include a first or last name before conversion.',
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

function contactPatch(contact: Contact, candidate: IncompleteCandidate): Partial<Contact> {
  const { tags, ...fields } = candidate;
  const input: Partial<Contact> = { ...fields, ...(tags ? { tags: [...tags] } : {}) };
  const patch: Partial<Contact> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      value !== undefined
      && JSON.stringify(contact[key as keyof Contact]) !== JSON.stringify(value)
    ) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

function conversionReceipt(data: unknown): IncompleteConversionReceipt {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new IncompleteRecordError('conflict', 'Conversion returned an invalid receipt.');
  }
  const envelope = data as ConversionEnvelope;
  if (
    typeof envelope.contactId !== 'string'
    || (envelope.action !== 'create'
      && envelope.action !== 'update'
      && envelope.action !== 'unchanged')
    || typeof envelope.noOp !== 'boolean'
    || !envelope.record
    || typeof envelope.record !== 'object'
    || Array.isArray(envelope.record)
  ) {
    throw new IncompleteRecordError('conflict', 'Conversion returned an invalid receipt.');
  }
  return {
    record: toRecord(envelope.record as IncompleteRecordRow),
    contactId: envelope.contactId,
    action: envelope.action,
    noOp: envelope.noOp,
  };
}

export function supabaseIncompleteRecordRepository(
  supabase: SupabaseClient,
): IncompleteRecordRepository {
  async function get(scope: WorkspaceScope, id: string): Promise<IncompleteRecord | undefined> {
    const { data, error } = await supabase
      .from('incomplete_records')
      .select(INCOMPLETE_COLUMNS)
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw persistenceError('Failed to load incomplete record', error);
    return data ? toRecord(data as unknown as IncompleteRecordRow) : undefined;
  }

  return {
    async list(untrustedScope, query) {
      const scope = liveScope(untrustedScope);
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > INCOMPLETE_FETCH_LIMIT) {
        throw new IncompleteRecordError('invalid-input', 'Incomplete record limit must be 1–500.');
      }
      const needle = query.query?.trim().toLowerCase();
      if (needle && needle.length > INCOMPLETE_QUERY_MAX) {
        throw new IncompleteRecordError('invalid-input', 'Incomplete record query is too long.');
      }
      let builder = supabase
        .from('incomplete_records')
        .select(INCOMPLETE_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (query.status && query.status !== 'all') builder = builder.eq('status', query.status);
      const { data, error } = await builder
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(INCOMPLETE_FETCH_LIMIT);
      if (error) throw persistenceError('Failed to list incomplete records', error);
      return ((data ?? []) as unknown as IncompleteRecordRow[])
        .map(toRecord)
        .filter((record) => {
          if (!needle) return true;
          return [record.id, record.source, record.externalId, record.candidate.firstName, record.candidate.lastName]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(needle));
        })
        .slice(0, query.limit);
    },

    async get(untrustedScope, id) {
      return get(liveScope(untrustedScope), id);
    },

    async create(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (!hasSafeIdentity(input.candidate, input.externalId)) {
        throw new IncompleteRecordError('invalid-input', 'Candidate has no safe identity signal.');
      }
      const { data, error } = await supabase.rpc('create_incomplete_record', {
        target_workspace_id: scope.workspaceId,
        target_source: input.source,
        target_external_id: input.externalId ?? null,
        target_candidate: input.candidate,
        target_validation_reasons: input.reasons,
        target_intake_idempotency_key: input.intakeIdempotencyKey ?? null,
        target_actor_membership_id: scope.membershipId,
      });
      if (error) throw persistenceError('Failed to create incomplete record', error);
      return toRecord(data as unknown as IncompleteRecordRow);
    },

    async previewConversion(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      const record = await get(scope, input.recordId);
      if (!record) throw new IncompleteRecordError('not-found', 'Incomplete record not found.');
      if (record.status === 'archived') {
        throw new IncompleteRecordError('conflict', 'Archived records must be restored before conversion.');
      }

      const contacts = (await supabaseRepository(supabase, scope).list()).slice(0, INCOMPLETE_FETCH_LIMIT);
      let matched: Contact | undefined;
      let matchedBy: IncompleteContactConversionPlan['matchedBy'];
      if (record.externalId) {
        const { data, error } = await supabase
          .from('contact_external_links')
          .select('contact_id')
          .eq('workspace_id', scope.workspaceId)
          .eq('provider', record.source)
          .eq('external_id', record.externalId)
          .maybeSingle();
        if (error) throw persistenceError('Failed to resolve external identity', error);
        const contactId = (data as unknown as { contact_id?: string } | null)?.contact_id;
        matched = contactId ? contacts.find((contact) => contact.id === contactId) : undefined;
        if (matched) matchedBy = 'external-id';
      }
      const email = normalizeEmail(input.candidate.email);
      const phone = normalizePhone(input.candidate.phone);
      if (!matched && email) {
        matched = contacts.find((contact) => normalizeEmail(contact.email) === email);
        if (matched) matchedBy = 'email';
      }
      if (!matched && phone) {
        matched = contacts.find((contact) => normalizePhone(contact.phone) === phone);
        if (matched) matchedBy = 'phone';
      }
      if (!matched) {
        const created = contactInput(input.candidate);
        return { action: 'create', contactInput: created, changes: Object.keys(created) };
      }
      const patch = contactPatch(matched, input.candidate);
      const changes = Object.keys(patch);
      return {
        action: changes.length ? 'update' : 'unchanged',
        matchedContactId: matched.id,
        ...(matchedBy ? { matchedBy } : {}),
        ...(changes.length ? { contactPatch: patch } : {}),
        changes,
      };
    },

    async convertAtomically(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (input.actorMembershipId !== scope.membershipId) {
        throw new IncompleteRecordError('forbidden', 'Actor does not match workspace membership.');
      }
      const { data, error } = await supabase.rpc('convert_incomplete_record', {
        target_record_id: input.recordId,
        target_candidate: input.candidate,
        target_plan: input.plan,
        target_idempotency_key: input.idempotencyKey,
        target_actor_membership_id: scope.membershipId,
        target_converted_at: input.convertedAt,
      });
      if (error) throw persistenceError('Failed to convert incomplete record', error);
      return conversionReceipt(data);
    },

    async archive(untrustedScope, id, input) {
      const scope = liveScope(untrustedScope);
      if (input.actorMembershipId !== scope.membershipId) {
        throw new IncompleteRecordError('forbidden', 'Actor does not match workspace membership.');
      }
      const current = await get(scope, id);
      if (!current) throw new IncompleteRecordError('not-found', 'Incomplete record not found.');
      if (current.status === 'converted') {
        throw new IncompleteRecordError('conflict', 'Converted records cannot be archived.');
      }
      if (current.status === 'archived') return { record: current, noOp: true };
      const { data, error } = await supabase
        .from('incomplete_records')
        .update({
          status: 'archived',
          archived_at: input.archivedAt,
          archived_by_membership_id: scope.membershipId,
          archive_reason: input.reason,
        })
        .eq('workspace_id', scope.workspaceId)
        .eq('id', id)
        .eq('status', 'pending')
        .select(INCOMPLETE_COLUMNS)
        .maybeSingle();
      if (error) throw persistenceError('Failed to archive incomplete record', error);
      if (data) return { record: toRecord(data as unknown as IncompleteRecordRow), noOp: false };
      const raced = await get(scope, id);
      if (raced?.status === 'archived') return { record: raced, noOp: true };
      throw new IncompleteRecordError('conflict', 'Incomplete record changed before archive.');
    },

    async restore(untrustedScope, id, restoredAt) {
      const scope = liveScope(untrustedScope);
      const current = await get(scope, id);
      if (!current) throw new IncompleteRecordError('not-found', 'Incomplete record not found.');
      if (current.status === 'converted') {
        throw new IncompleteRecordError('conflict', 'Converted records cannot return to pending.');
      }
      if (current.status === 'pending') return { record: current, noOp: true };
      const { data, error } = await supabase
        .from('incomplete_records')
        .update({
          status: 'pending',
          archived_at: null,
          archived_by_membership_id: null,
          archive_reason: null,
          updated_at: restoredAt,
        })
        .eq('workspace_id', scope.workspaceId)
        .eq('id', id)
        .eq('status', 'archived')
        .select(INCOMPLETE_COLUMNS)
        .maybeSingle();
      if (error) throw persistenceError('Failed to restore incomplete record', error);
      if (data) return { record: toRecord(data as unknown as IncompleteRecordRow), noOp: false };
      const raced = await get(scope, id);
      if (raced?.status === 'pending') return { record: raced, noOp: true };
      throw new IncompleteRecordError('conflict', 'Incomplete record changed before restore.');
    },
  };
}
