import type { SupabaseClient } from '@supabase/supabase-js';
import { CaptureOutcomeError, type CaptureOutcomeProposal } from '../domain/capture-outcome.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { CaptureOutcomeRepository } from './capture-outcome-repository.ts';
function live(scope: WorkspaceScope) {
  const checked = validateWorkspaceScope(scope);
  if (checked.mode !== 'live') throw new CaptureOutcomeError('forbidden', 'Live capture requires authenticated workspace membership.');
  return checked;
}
function failure(error: { code?: string } | null) {
  if (error) throw new CaptureOutcomeError(error.code === '42501' ? 'forbidden' : error.code === '40001' || error.code === '23505' ? 'conflict' : 'unavailable', 'Capture persistence could not complete. Reload and retry.');
}
export function supabaseCaptureOutcomeRepository(client: SupabaseClient): CaptureOutcomeRepository {
  return {
    async get(scopeInput, id) {
      const scope = live(scopeInput);
      const { data, error } = await client.from('capture_outcomes').select('document').eq('workspace_id', scope.workspaceId).eq('id', id).maybeSingle();
      failure(error); return data?.document as CaptureOutcomeProposal | undefined;
    },
    async list(scopeInput, contactId) {
      const scope = live(scopeInput);
      let request = client.from('capture_outcomes').select('document').eq('workspace_id', scope.workspaceId).order('created_at', { ascending: false }).limit(50);
      if (contactId) request = request.eq('contact_id', contactId);
      const { data, error } = await request;
      failure(error); return (data ?? []).map((row) => row.document as CaptureOutcomeProposal);
    },
    async findByKey(scopeInput, key) {
      const scope = live(scopeInput);
      const { data, error } = await client.from('capture_outcomes').select('document').eq('workspace_id', scope.workspaceId).eq('idempotency_key', key).maybeSingle();
      failure(error); return data?.document as CaptureOutcomeProposal | undefined;
    },
    async create(scopeInput, document, key) {
      const scope = live(scopeInput);
      const { data, error } = await client.rpc('save_capture_outcome', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_document: document, target_expected_revision: null, target_idempotency_key: key });
      failure(error); return data as CaptureOutcomeProposal;
    },
    async save(scopeInput, document, revision) {
      const scope = live(scopeInput);
      const { data, error } = await client.rpc('save_capture_outcome', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_document: document, target_expected_revision: revision, target_idempotency_key: null });
      failure(error); return data as CaptureOutcomeProposal;
    },
    async appendNote(scopeInput, input) {
      const scope = live(scopeInput);
      const { data, error } = await client.rpc('append_capture_outcome_note', { target_workspace_id: scope.workspaceId, target_membership_id: scope.membershipId, target_proposal_id: input.proposalId, target_proposal_version: input.proposalVersion, target_contact_id: input.contactId, target_body: input.body, target_idempotency_key: input.idempotencyKey, target_occurred_at: input.occurredAt });
      failure(error); return data as { id: string };
    },
  };
}
