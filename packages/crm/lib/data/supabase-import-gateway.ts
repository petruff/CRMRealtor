import type { SupabaseClient } from '@supabase/supabase-js';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import {
  CONTACT_INTAKE_PENDING_STATUS,
  verifyContactImportPlanOutcome,
  verifyContactImportGroupOutcome,
  type ContactExternalLink,
  type ImportGateway,
  type IntakeReceipt,
} from './import-gateway.ts';
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function supabaseImportGateway(
  supabase: SupabaseClient,
  untrustedScope: WorkspaceScope,
  identityMap?: ContactIdentityMap,
): ImportGateway {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') throw new Error('Supabase gateways require a live workspace scope.');

  async function loadReceipt(idempotencyKey: string): Promise<IntakeReceipt | undefined> {
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
    };
  }

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
      return loadReceipt(idempotencyKey);
    },
    async claimReceipt(receipt, correlationId) {
      if (receipt.statusCode !== CONTACT_INTAKE_PENDING_STATUS) {
        throw new Error('Intake receipt reservation must use the pending status.');
      }
      const { data, error } = await supabase.rpc('begin_contact_intake_receipt', {
        target_workspace_id: scope.workspaceId,
        target_actor_membership_id: scope.membershipId,
        target_idempotency_key: receipt.idempotencyKey,
        target_request_hash: receipt.requestHash,
        target_correlation_id: correlationId,
        target_occurred_at: receipt.createdAt,
      });
      if (error) throw new Error(`Failed to reserve intake receipt: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || !['pending', 'terminal'].includes(String((data as Record<string, unknown>).state))
        || typeof (data as Record<string, unknown>).noOp !== 'boolean') {
        throw new Error('Intake receipt reservation returned an invalid outcome.');
      }
      return !(data as Record<string, unknown>).noOp;
    },
    async completeReceipt(receipt, correlationId) {
      if (receipt.statusCode < 200 || receipt.statusCode > 599
        || !receipt.response || typeof receipt.response !== 'object' || Array.isArray(receipt.response)) {
        throw new Error('Intake receipt finalization requires an object response and terminal status.');
      }
      const { data, error } = await supabase.rpc('finalize_contact_intake_receipt', {
        target_workspace_id: scope.workspaceId,
        target_actor_membership_id: scope.membershipId,
        target_idempotency_key: receipt.idempotencyKey,
        target_request_hash: receipt.requestHash,
        target_status_code: receipt.statusCode,
        target_response_json: receipt.response,
        target_correlation_id: correlationId,
        target_occurred_at: receipt.createdAt,
      });
      if (error) throw new Error(`Failed to finalize intake receipt: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || (data as Record<string, unknown>).state !== 'terminal') {
        throw new Error('Intake receipt finalization returned an invalid outcome.');
      }
      const recorded = await loadReceipt(receipt.idempotencyKey);
      if (!recorded || recorded.requestHash !== receipt.requestHash
        || recorded.statusCode !== receipt.statusCode
        || canonicalJson(recorded.response) !== canonicalJson(receipt.response)) {
        throw new Error('Finalized intake receipt does not match durable evidence.');
      }
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
      return verifyContactImportGroupOutcome({
        command,
        mutation: data,
        receipt: await loadReceipt(command.groupIdempotencyKey),
      });
    },
    async applyContactImportPlan(command) {
      if (command.scope.workspaceId !== scope.workspaceId
        || command.scope.membershipId !== scope.membershipId) {
        throw new Error('Import plan authority does not match authenticated workspace.');
      }
      const { data, error } = await supabase.rpc('apply_contact_import_plan', {
        target_workspace_id: scope.workspaceId,
        target_actor_membership_id: scope.membershipId,
        target_idempotency_key: command.idempotencyKey,
        target_request_hash: command.requestHash,
        target_source: command.source,
        target_format: command.format,
        target_file_hash: command.fileHash,
        target_ordered_plan: command.orderedPlan,
        target_mapping_profile_id: command.mappingProfileId ?? null,
        target_mapping_version: command.mappingVersion ?? null,
        target_started_at: command.startedAt,
        target_completed_at: command.completedAt,
        target_correlation_id: command.correlationId,
      });
      if (error) throw new Error(`Failed to apply atomic import plan: ${error.message}`);
      return verifyContactImportPlanOutcome({
        command,
        mutation: data,
        receipt: await loadReceipt(command.idempotencyKey),
      });
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
