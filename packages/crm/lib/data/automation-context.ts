import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IntakeConfiguration } from '../application/intake-security.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { supabaseImportGateway } from './supabase-import-gateway.ts';
import { supabaseRepository } from './supabase-repository.ts';
import { supabaseSmartListRepository } from './supabase-smart-list-repository.ts';
import { supabaseIncompleteRecordRepository } from './supabase-incomplete-record-repository.ts';
import { supabaseActivityRepository } from './supabase-activity-repository.ts';
import { supabaseAttentionRepository } from './supabase-attention-repository.ts';

interface ActiveOwnerMembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner';
  status: 'active';
}

/**
 * Resolve a privileged intake binding from server configuration and already
 * filtered active-owner rows. Request data never participates in this choice.
 */
export function resolveAutomationWorkspaceScope(
  configuration: Pick<IntakeConfiguration, 'workspaceId' | 'ownerId'>,
  rows: readonly ActiveOwnerMembershipRow[],
): WorkspaceScope {
  const candidates = rows.filter((row) => {
    if (row.role !== 'owner' || row.status !== 'active') return false;
    if (configuration.workspaceId && row.workspace_id !== configuration.workspaceId) return false;
    if (configuration.ownerId && row.user_id !== configuration.ownerId) return false;
    return true;
  });

  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0
      ? 'Automatic intake binding has no unique active owner workspace.'
      : 'Automatic intake binding is ambiguous.');
  }

  const membership = candidates[0];
  if (!membership) throw new Error('Automatic intake binding is unavailable.');
  return {
    authenticatedUserId: membership.user_id,
    ownerUserId: membership.user_id,
    membershipId: membership.id,
    workspaceId: membership.workspace_id,
    role: 'owner',
    mode: 'live',
  };
}

async function loadBoundOwnerMemberships(
  client: SupabaseClient,
  configuration: IntakeConfiguration,
): Promise<ActiveOwnerMembershipRow[]> {
  const columns = 'id, workspace_id, user_id, role, status';
  const base = client
    .from('workspace_members')
    .select(columns)
    .eq('role', 'owner')
    .eq('status', 'active');

  const { data, error } = configuration.workspaceId
    ? await base.eq('workspace_id', configuration.workspaceId).limit(2)
    : await base.eq('user_id', configuration.ownerId as string).limit(2);

  if (error) throw new Error(`Automatic intake workspace lookup failed: ${error.message}`);
  return (data ?? []) as ActiveOwnerMembershipRow[];
}

/** Resolve a server-configured workspace for non-browser CLI/automation use. */
export async function resolveServerWorkspaceScope(
  client: SupabaseClient,
  binding: Pick<IntakeConfiguration, 'workspaceId' | 'ownerId'>,
): Promise<WorkspaceScope> {
  if (!binding.workspaceId && !binding.ownerId) {
    throw new Error('A server workspace binding is required.');
  }
  const rows = await loadBoundOwnerMemberships(client, {
    url: '',
    serviceRoleKey: '',
    token: '',
    ...binding,
  });
  return resolveAutomationWorkspaceScope(binding, rows);
}

export function createAutomationRepositories(client: SupabaseClient, workspaceScope: WorkspaceScope) {
  return {
    repository: supabaseRepository(client, workspaceScope),
    importGateway: supabaseImportGateway(client, workspaceScope),
    smartListRepository: supabaseSmartListRepository(client),
    incompleteRecordRepository: supabaseIncompleteRecordRepository(client),
    activityRepository: supabaseActivityRepository(client),
    attentionRepository: supabaseAttentionRepository(client),
  };
}

/** Privileged context for authenticated intake. There is deliberately no demo path. */
export async function createAutomationContext(configuration: IntakeConfiguration) {
  const client = createClient(configuration.url, configuration.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workspaceScope = await resolveServerWorkspaceScope(client, configuration);
  return {
    ...createAutomationRepositories(client, workspaceScope),
    workspaceScope,
  };
}
