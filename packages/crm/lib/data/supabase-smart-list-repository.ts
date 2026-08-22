import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseSmartListDefinition,
  parseSmartListName,
  SmartListValidationError,
  type SmartList,
  type SmartListStatus,
} from '../domain/smart-list.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { SmartListRepository } from './smart-list-repository.ts';

interface SmartListRow {
  id: string;
  workspace_id: string;
  name: string;
  definition: unknown;
  status: SmartListStatus;
  created_by_membership_id: string;
  archived_at: string | null;
  archived_by_membership_id: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

const SMART_LIST_COLUMNS = [
  'id', 'workspace_id', 'name', 'definition', 'status', 'created_by_membership_id',
  'archived_at', 'archived_by_membership_id', 'archive_reason', 'created_at', 'updated_at',
].join(', ');
const SMART_LIST_QUERY_LIMIT = 500;

function liveScope(untrustedScope: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') {
    throw new SmartListValidationError('Supabase Smart Lists require a live workspace scope.');
  }
  return scope;
}

function toSmartList(row: SmartListRow): SmartList {
  if (row.status !== 'active' && row.status !== 'archived') {
    throw new SmartListValidationError('Smart List persistence returned an invalid status.');
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: parseSmartListName(row.name),
    definition: parseSmartListDefinition(row.definition),
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by_membership_id
      ? { archivedByMembershipId: row.archived_by_membership_id }
      : {}),
    ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}),
  };
}

function persistenceError(message: string, error: { code?: string; message: string }): Error {
  return new SmartListValidationError(
    error.code === '23505' ? `${message}: conflicting record.` : `${message}: persistence failed.`,
    {},
    'conflict',
  );
}

export function supabaseSmartListRepository(supabase: SupabaseClient): SmartListRepository {
  async function get(scope: WorkspaceScope, id: string): Promise<SmartList | undefined> {
    const { data, error } = await supabase
      .from('smart_lists')
      .select(SMART_LIST_COLUMNS)
      .eq('workspace_id', scope.workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw persistenceError('Failed to load Smart List', error);
    return data ? toSmartList(data as unknown as SmartListRow) : undefined;
  }

  return {
    async list(untrustedScope, status = 'active') {
      const scope = liveScope(untrustedScope);
      let query = supabase
        .from('smart_lists')
        .select(SMART_LIST_COLUMNS)
        .eq('workspace_id', scope.workspaceId);
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .limit(SMART_LIST_QUERY_LIMIT);
      if (error) throw persistenceError('Failed to list Smart Lists', error);
      return ((data ?? []) as unknown as SmartListRow[]).map(toSmartList);
    },

    async get(untrustedScope, id) {
      return get(liveScope(untrustedScope), id);
    },

    async create(untrustedScope, input) {
      const scope = liveScope(untrustedScope);
      if (input.createdByMembershipId !== scope.membershipId) {
        throw new SmartListValidationError(
          'Smart List actor does not match workspace authority.',
          {},
          'conflict',
        );
      }
      const { data, error } = await supabase
        .from('smart_lists')
        .insert({
          workspace_id: scope.workspaceId,
          name: parseSmartListName(input.name),
          definition: parseSmartListDefinition(input.definition),
          status: 'active',
          created_by_membership_id: scope.membershipId,
          created_at: input.createdAt,
          updated_at: input.createdAt,
        })
        .select(SMART_LIST_COLUMNS)
        .single();
      if (error) throw persistenceError('Failed to create Smart List', error);
      return toSmartList(data as unknown as SmartListRow);
    },

    async update(untrustedScope, id, input) {
      const scope = liveScope(untrustedScope);
      const patch = {
        ...(input.name === undefined ? {} : { name: parseSmartListName(input.name) }),
        ...(input.definition === undefined
          ? {}
          : { definition: parseSmartListDefinition(input.definition) }),
        updated_at: input.updatedAt,
      };
      const { data, error } = await supabase
        .from('smart_lists')
        .update(patch)
        .eq('workspace_id', scope.workspaceId)
        .eq('id', id)
        .select(SMART_LIST_COLUMNS)
        .maybeSingle();
      if (error) throw persistenceError('Failed to update Smart List', error);
      if (!data) throw new SmartListValidationError('Smart List not found.', {}, 'conflict');
      return toSmartList(data as unknown as SmartListRow);
    },

    async archive(untrustedScope, id, input) {
      const scope = liveScope(untrustedScope);
      if (input.actorMembershipId !== scope.membershipId) {
        throw new SmartListValidationError(
          'Smart List actor does not match workspace authority.',
          {},
          'conflict',
        );
      }
      const current = await get(scope, id);
      if (!current) throw new SmartListValidationError('Smart List not found.', {}, 'conflict');
      if (current.status === 'archived') return { list: current, noOp: true };
      const { data, error } = await supabase
        .from('smart_lists')
        .update({
          status: 'archived',
          archived_at: input.archivedAt,
          archived_by_membership_id: scope.membershipId,
          archive_reason: input.reason ?? null,
        })
        .eq('workspace_id', scope.workspaceId)
        .eq('id', id)
        .eq('status', 'active')
        .select(SMART_LIST_COLUMNS)
        .maybeSingle();
      if (error) throw persistenceError('Failed to archive Smart List', error);
      if (data) return { list: toSmartList(data as unknown as SmartListRow), noOp: false };
      const raced = await get(scope, id);
      if (raced?.status === 'archived') return { list: raced, noOp: true };
      throw new SmartListValidationError('Smart List not found.', {}, 'conflict');
    },

    async restore(untrustedScope, id, restoredAt) {
      const scope = liveScope(untrustedScope);
      const current = await get(scope, id);
      if (!current) throw new SmartListValidationError('Smart List not found.', {}, 'conflict');
      if (current.status === 'active') return { list: current, noOp: true };
      const { data, error } = await supabase
        .from('smart_lists')
        .update({
          status: 'active',
          archived_at: null,
          archived_by_membership_id: null,
          archive_reason: null,
          updated_at: restoredAt,
        })
        .eq('workspace_id', scope.workspaceId)
        .eq('id', id)
        .eq('status', 'archived')
        .select(SMART_LIST_COLUMNS)
        .maybeSingle();
      if (error) throw persistenceError('Failed to restore Smart List', error);
      if (data) return { list: toSmartList(data as unknown as SmartListRow), noOp: false };
      const raced = await get(scope, id);
      if (raced?.status === 'active') return { list: raced, noOp: true };
      throw new SmartListValidationError('Smart List not found.', {}, 'conflict');
    },
  };
}
