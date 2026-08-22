import type { SupabaseClient } from '@supabase/supabase-js';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ContactOutboundGuard, ContactOutboundTarget } from './contact-outbound-guard.ts';

export function supabaseContactOutboundGuard(supabase: SupabaseClient): ContactOutboundGuard {
  return {
    async assertTarget(untrustedScope: WorkspaceScope, contactId: string, contactPointId?: string, reviewedAliasEpoch?: number) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Outbound contact guard requires a live workspace scope.');
      const { data, error } = await supabase.rpc('assert_contact_outbound_target', {
        target_workspace_id: scope.workspaceId,
        target_contact_id: contactId,
        target_contact_point_id: contactPointId ?? null,
      });
      if (error) throw new Error(`Outbound target requires manual review: ${error.message}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Outbound target guard returned an invalid receipt.');
      }
      const receipt = data as Record<string, unknown>;
      if (receipt.contactId !== contactId || (receipt.contactPointId ?? undefined) !== contactPointId
        || !Number.isSafeInteger(Number(receipt.aliasEpoch)) || Number(receipt.aliasEpoch) < 0) {
        throw new Error('Outbound target guard returned an invalid receipt.');
      }
      const aliasEpoch = Number(receipt.aliasEpoch);
      if (reviewedAliasEpoch !== undefined && aliasEpoch !== reviewedAliasEpoch) {
        throw new Error('Outbound target requires manual review: contact alias state changed after review.');
      }
      return {
        contactId,
        ...(contactPointId ? { contactPointId } : {}),
        aliasEpoch,
      } satisfies ContactOutboundTarget;
    },
  };
}

/** Service-worker equivalent of the authenticated RPC, for the final pre-provider recheck. */
export function supabaseServiceContactOutboundGuard(supabase: SupabaseClient): ContactOutboundGuard {
  return {
    async assertTarget(untrustedScope, contactId, contactPointId, reviewedAliasEpoch) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new Error('Outbound contact guard requires a live workspace scope.');
      const contactResult = await supabase.from('contacts').select('id,archived_at')
        .eq('workspace_id', scope.workspaceId).eq('id', contactId).maybeSingle();
      if (contactResult.error || !contactResult.data || contactResult.data.archived_at) {
        throw new Error('Outbound target requires manual review: contact is unavailable.');
      }
      const aliasResult = await supabase.from('contact_merge_aliases').select('donor_contact_id')
        .eq('workspace_id', scope.workspaceId).eq('donor_contact_id', contactId).is('inactive_at', null).limit(1);
      if (aliasResult.error || (aliasResult.data?.length ?? 0) > 0) {
        throw new Error('Outbound target requires manual review: contact is an aliased donor.');
      }
      if (contactPointId) {
        const pointResult = await supabase.from('contact_points').select('id')
          .eq('workspace_id', scope.workspaceId).eq('contact_id', contactId).eq('id', contactPointId)
          .is('archived_at', null).maybeSingle();
        if (pointResult.error || !pointResult.data) {
          throw new Error('Outbound target requires manual review: contact point is unavailable.');
        }
      }
      const epochResult = await supabase.from('contact_merge_workspace_state').select('alias_epoch')
        .eq('workspace_id', scope.workspaceId).maybeSingle();
      if (epochResult.error) throw new Error('Outbound target requires manual review: alias state is unavailable.');
      const aliasEpoch = Number(epochResult.data?.alias_epoch ?? 0);
      if (!Number.isSafeInteger(aliasEpoch) || aliasEpoch < 0) {
        throw new Error('Outbound target guard returned an invalid receipt.');
      }
      if (reviewedAliasEpoch !== undefined && reviewedAliasEpoch !== aliasEpoch) {
        throw new Error('Outbound target requires manual review: contact alias state changed after review.');
      }
      return { contactId, ...(contactPointId ? { contactPointId } : {}), aliasEpoch };
    },
  };
}
