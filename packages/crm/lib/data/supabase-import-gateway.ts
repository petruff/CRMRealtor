import type { SupabaseClient } from '@supabase/supabase-js';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ContactExternalLink, ImportGateway, IntakeReceipt } from './import-gateway.ts';
import type { ContactIdentityMap } from './contact-identity-map.ts';

interface LinkRow {
  provider: string;
  external_id: string;
  contact_id: string;
}

interface ReceiptRow {
  idempotency_key: string;
  request_hash: string;
  status_code: number;
  response_json: unknown;
  created_at: string;
}

export function supabaseImportGateway(
  supabase: SupabaseClient,
  untrustedScope: WorkspaceScope,
  identityMap?: ContactIdentityMap,
): ImportGateway {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') throw new Error('Supabase gateways require a live workspace scope.');

  return {
    async linksFor(provider, externalIds) {
      if (externalIds.length === 0) return [];
      const { data, error } = await supabase
        .from('contact_external_links')
        .select('provider, external_id, contact_id')
        .eq('workspace_id', scope.workspaceId)
        .eq('provider', provider)
        .in('external_id', externalIds);
      if (error) throw new Error(`Failed to load import identities: ${error.message}`);
      const links = (data as LinkRow[]).map(
        (row): ContactExternalLink => ({
          provider: row.provider,
          externalId: row.external_id,
          contactId: row.contact_id,
        }),
      );
      if (!identityMap || links.length === 0) return links;
      const aliases = await identityMap.resolvePage(scope, links.map((link) => link.contactId));
      return links.map((link) => ({ ...link, contactId: aliases.get(link.contactId) ?? link.contactId }));
    },
    async linkContact(link) {
      const { error } = await supabase.from('contact_external_links').insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.ownerUserId,
        provider: link.provider,
        external_id: link.externalId,
        contact_id: link.contactId,
      });
      if (!error) return;
      if (error.code !== '23505') throw new Error(`Failed to save import identity: ${error.message}`);

      const { data, error: lookupError } = await supabase
        .from('contact_external_links')
        .select('contact_id')
        .eq('workspace_id', scope.workspaceId)
        .eq('provider', link.provider)
        .eq('external_id', link.externalId)
        .maybeSingle();
      if (lookupError || !data || (data as { contact_id: string }).contact_id !== link.contactId) {
        throw new Error('External identity is already linked to another contact.');
      }
    },
    async getReceipt(idempotencyKey) {
      const { data, error } = await supabase
        .from('contact_intake_receipts')
        .select('idempotency_key, request_hash, status_code, response_json, created_at')
        .eq('workspace_id', scope.workspaceId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) throw new Error(`Failed to load intake receipt: ${error.message}`);
      if (!data) return undefined;
      const row = data as ReceiptRow;
      return {
        idempotencyKey: row.idempotency_key,
        requestHash: row.request_hash,
        statusCode: row.status_code,
        response: row.response_json,
        createdAt: row.created_at,
      } satisfies IntakeReceipt;
    },
    async claimReceipt(receipt) {
      const { error } = await supabase.from('contact_intake_receipts').insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.ownerUserId,
        idempotency_key: receipt.idempotencyKey,
        request_hash: receipt.requestHash,
        status_code: receipt.statusCode,
        response_json: receipt.response,
        created_at: receipt.createdAt,
      });
      if (error?.code === '23505') return false;
      if (error) throw new Error(`Failed to reserve intake receipt: ${error.message}`);
      return true;
    },
    async completeReceipt(receipt) {
      const { data, error } = await supabase
        .from('contact_intake_receipts')
        .update({ status_code: receipt.statusCode, response_json: receipt.response })
        .eq('workspace_id', scope.workspaceId)
        .eq('idempotency_key', receipt.idempotencyKey)
        .eq('request_hash', receipt.requestHash)
        .select('id')
        .maybeSingle();
      if (error || !data) throw new Error(`Failed to complete intake receipt: ${error?.message ?? 'reservation not found'}`);
    },
    async releaseReceipt(idempotencyKey, requestHash) {
      const { error } = await supabase
        .from('contact_intake_receipts')
        .delete()
        .eq('workspace_id', scope.workspaceId)
        .eq('idempotency_key', idempotencyKey)
        .eq('request_hash', requestHash)
        .eq('status_code', 202);
      if (error) throw new Error(`Failed to release intake receipt: ${error.message}`);
    },
    async resolveContactImportIdentity(input) {
      if (input.scope.workspaceId !== scope.workspaceId) throw new Error('Import identity scope does not match authenticated workspace.');
      const { data, error } = await supabase.rpc('resolve_contact_import_identity', {
        target_workspace_id: scope.workspaceId,
        target_provider: input.provider,
        target_external_id: input.externalId ?? null,
        target_email: input.email ?? null,
        target_phone: input.phone ?? null,
      });
      if (error) throw new Error(`Failed to resolve import identity: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Import identity returned an invalid receipt.');
      const row = data as Record<string, unknown>;
      if (!['none', 'active-match', 'archived-match', 'ambiguous-identity'].includes(String(row.outcome))
        || !Number.isInteger(row.matchCount) || Number(row.matchCount) < 0) {
        throw new Error('Import identity returned an invalid receipt.');
      }
      const physicalContactId = typeof row.contactId === 'string' ? row.contactId : undefined;
      const canonicalContactId = physicalContactId && identityMap
        ? await identityMap.resolveCanonical(scope, physicalContactId)
        : physicalContactId;
      return {
        outcome: row.outcome as 'none' | 'active-match' | 'archived-match' | 'ambiguous-identity',
        ...(canonicalContactId ? { contactId: canonicalContactId } : {}),
        ...(['external-id', 'email', 'phone'].includes(String(row.matchedBy))
          ? { matchedBy: row.matchedBy as 'external-id' | 'email' | 'phone' } : {}),
        matchCount: Number(row.matchCount),
      };
    },
    async applyContactImportGroup(command) {
      if (command.scope.workspaceId !== scope.workspaceId
        || command.scope.membershipId !== scope.membershipId) {
        throw new Error('Import group authority does not match authenticated workspace.');
      }
      const canonicalContactId = command.plan.contactId && identityMap
        ? await identityMap.resolveCanonical(scope, command.plan.contactId)
        : command.plan.contactId;
      const { data, error } = await supabase.rpc('apply_contact_import_group', {
        target_workspace_id: scope.workspaceId,
        target_actor_membership_id: scope.membershipId,
        target_group_idempotency_key: command.groupIdempotencyKey,
        target_request_hash: command.requestHash,
        target_plan: canonicalContactId === command.plan.contactId
          ? command.plan
          : { ...command.plan, contactId: canonicalContactId },
        target_occurred_at: command.occurredAt,
      });
      if (error) throw new Error(`Failed to apply atomic import group: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Atomic import returned an invalid receipt.');
      const row = data as Record<string, unknown>;
      if (typeof row.contactId !== 'string' || !['create', 'update', 'unchanged'].includes(String(row.action))
        || typeof row.notesAdded !== 'boolean' || typeof row.noOp !== 'boolean') {
        throw new Error('Atomic import returned an invalid receipt.');
      }
      return {
        contactId: row.contactId,
        action: row.action as 'create' | 'update' | 'unchanged',
        notesAdded: row.notesAdded,
        noOp: row.noOp,
      };
    },
    async applyImportedContactOrganization(command) {
      if (command.scope.workspaceId !== scope.workspaceId
        || command.scope.membershipId !== scope.membershipId
        || command.scope.role !== 'owner') {
        throw new Error('Historical organization authority does not match the active workspace owner.');
      }
      const { data, error } = await supabase.rpc('apply_imported_contact_organization', {
        target_workspace_id: scope.workspaceId,
        target_actor_membership_id: scope.membershipId,
        target_policy_version: command.policyVersion,
        target_request_hash: command.requestHash,
        target_changes: command.changes,
        target_occurred_at: command.occurredAt,
      });
      if (error) throw new Error(`Historical organization was not applied: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Historical organization returned an invalid receipt.');
      const row = data as Record<string, unknown>;
      if (typeof row.runId !== 'string' || !Number.isInteger(row.contactCount)
        || !['applied', 'rolled-back'].includes(String(row.state)) || typeof row.noOp !== 'boolean') {
        throw new Error('Historical organization returned an invalid receipt.');
      }
      return {
        runId: row.runId,
        contactCount: Number(row.contactCount),
        state: row.state as 'applied' | 'rolled-back',
        noOp: row.noOp,
        rollbackAvailable: Boolean(row.rollbackAvailable),
      };
    },
    async rollbackImportedContactOrganization(command) {
      if (command.scope.workspaceId !== scope.workspaceId
        || command.scope.membershipId !== scope.membershipId
        || command.scope.role !== 'owner') {
        throw new Error('Historical rollback authority does not match the active workspace owner.');
      }
      const { data, error } = await supabase.rpc('rollback_imported_contact_organization', {
        target_run_id: command.runId,
        target_actor_membership_id: scope.membershipId,
        target_request_hash: command.requestHash,
        target_occurred_at: command.occurredAt,
      });
      if (error) throw new Error(`Historical organization was not rolled back: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Historical rollback returned an invalid receipt.');
      const row = data as Record<string, unknown>;
      if (typeof row.runId !== 'string' || !Number.isInteger(row.contactCount)
        || row.state !== 'rolled-back' || typeof row.noOp !== 'boolean') {
        throw new Error('Historical rollback returned an invalid receipt.');
      }
      return {
        runId: row.runId,
        contactCount: Number(row.contactCount),
        state: 'rolled-back' as const,
        noOp: row.noOp,
        rollbackAvailable: false,
      };
    },
  };
}
