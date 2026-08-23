import type { SupabaseClient } from '@supabase/supabase-js';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { ContactAliasGroup, ContactIdentityMap } from './contact-identity-map.ts';
import { isMissingSchemaCapability } from './supabase-schema-compat.ts';

interface AliasGroupRow {
  contact_id: string;
  is_canonical: boolean;
  alias_epoch: number | string;
}

interface AliasRow {
  donor_contact_id: string;
  survivor_contact_id: string;
}

function live(input: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(input);
  if (scope.mode !== 'live') throw new Error('Contact identity resolution requires a live workspace scope.');
  return scope;
}

function failure(operation: string, error: { message: string }): Error {
  return new Error(`${operation}: ${error.message}`);
}

const MERGE_CAPABILITIES = [
  'contact_merge_aliases',
  'resolve_canonical_contact_id',
  'list_contact_alias_group_ids',
] as const;

const reportedMissingCapabilities = new Set<string>();

function reportMissingCapability(operation: string, error: { code?: string }): void {
  if (reportedMissingCapabilities.has(operation)) return;
  reportedMissingCapabilities.add(operation);
  console.warn('Contact merge capability is not installed; Omnix is using standalone contact reads.', {
    operation,
    code: error.code ?? 'schema-capability-missing',
  });
}

function standalone(contactId: string): ContactAliasGroup {
  return {
    requestedContactId: contactId,
    canonicalContactId: contactId,
    memberContactIds: [contactId],
    aliasEpoch: 0,
  };
}

export function supabaseContactIdentityMap(supabase: SupabaseClient): ContactIdentityMap {
  return {
    async resolveCanonical(input, contactId) {
      const scope = live(input);
      const { data, error } = await supabase.rpc('resolve_canonical_contact_id', {
        target_workspace_id: scope.workspaceId,
        target_contact_id: contactId,
      });
      if (error && isMissingSchemaCapability(error, MERGE_CAPABILITIES)) {
        reportMissingCapability('resolve-canonical-contact', error);
        return contactId;
      }
      if (error) throw failure('Failed to resolve canonical contact', error);
      if (typeof data !== 'string') throw new Error('Canonical contact resolver returned an invalid identifier.');
      return data;
    },

    async listGroupMembers(input, contactId) {
      const scope = live(input);
      const { data, error } = await supabase.rpc('list_contact_alias_group_ids', {
        target_workspace_id: scope.workspaceId,
        target_contact_id: contactId,
      });
      if (error && isMissingSchemaCapability(error, MERGE_CAPABILITIES)) {
        reportMissingCapability('list-contact-alias-group', error);
        return standalone(contactId);
      }
      if (error) throw failure('Failed to resolve contact alias group', error);
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Contact alias group resolver returned an invalid group.');
      }
      const rows = data as AliasGroupRow[];
      const canonical = rows.find((row) => row.is_canonical === true);
      if (!canonical || rows.some((row) => typeof row.contact_id !== 'string')) {
        throw new Error('Contact alias group resolver returned an invalid group.');
      }
      const epoch = Number(canonical.alias_epoch);
      if (!Number.isSafeInteger(epoch) || epoch < 0) {
        throw new Error('Contact alias group resolver returned an invalid epoch.');
      }
      return {
        requestedContactId: contactId,
        canonicalContactId: canonical.contact_id,
        memberContactIds: rows.map((row) => row.contact_id),
        aliasEpoch: epoch,
      } satisfies ContactAliasGroup;
    },

    async resolvePage(input, contactIds) {
      const scope = live(input);
      const unique = [...new Set(contactIds)];
      const resolved = new Map(unique.map((contactId) => [contactId, contactId]));
      if (unique.length === 0) return resolved;
      const { data, error } = await supabase
        .from('contact_merge_aliases')
        .select('donor_contact_id, survivor_contact_id')
        .eq('workspace_id', scope.workspaceId)
        .is('inactive_at', null);
      if (error && isMissingSchemaCapability(error, MERGE_CAPABILITIES)) {
        reportMissingCapability('resolve-contact-page-aliases', error);
        return resolved;
      }
      if (error) throw failure('Failed to resolve contact page aliases', error);
      for (const row of (data ?? []) as AliasRow[]) {
        if (resolved.has(row.donor_contact_id)) resolved.set(row.donor_contact_id, row.survivor_contact_id);
      }
      return resolved;
    },
  };
}
