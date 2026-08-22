import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';

export type ContactMergeEvidenceKind = 'external-id' | 'email' | 'phone';

export interface ContactMergePlanReceipt {
  readonly planId: string;
  readonly state: 'pending' | 'review-only';
  readonly survivorContactId: string;
  readonly snapshotHash: string;
  readonly memberCount: number;
  readonly reasonCodes: readonly string[];
  readonly noOp: boolean;
}

export async function planExactContactMerge(input: {
  readonly client: SupabaseClient;
  readonly scope: WorkspaceScope;
  readonly evidenceKind: ContactMergeEvidenceKind;
  readonly groupHash: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly expiresAt: string;
}): Promise<ContactMergePlanReceipt> {
  const scope = validateWorkspaceScope(input.scope);
  if (scope.mode !== 'live' || scope.role !== 'owner') {
    throw new Error('Contact merge planning requires an authenticated live workspace owner.');
  }
  if (!/^[a-f0-9]{64}$/.test(input.groupHash)) throw new Error('Contact merge group hash is invalid.');
  const requestHash = createHash('sha256').update(JSON.stringify({
    workspaceId: scope.workspaceId,
    evidenceKind: input.evidenceKind,
    groupHash: input.groupHash,
  })).digest('hex');
  const { data, error } = await input.client.rpc('plan_exact_contact_merge', {
    target_workspace_id: scope.workspaceId,
    target_actor_membership_id: scope.membershipId,
    target_evidence_kind: input.evidenceKind,
    target_group_hash: input.groupHash,
    target_request_hash: requestHash,
    target_idempotency_key: input.idempotencyKey,
    target_reason_codes: [],
    target_expires_at: input.expiresAt,
    target_occurred_at: input.occurredAt,
  });
  if (error) throw new Error(`Contact merge plan failed: ${error.message}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Contact merge planner returned an invalid receipt.');
  }
  const receipt = data as Record<string, unknown>;
  if (typeof receipt.planId !== 'string'
    || !['pending', 'review-only'].includes(String(receipt.state))
    || typeof receipt.survivorContactId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(receipt.snapshotHash))
    || !Number.isInteger(receipt.memberCount) || Number(receipt.memberCount) < 2
    || !Array.isArray(receipt.reasonCodes) || !receipt.reasonCodes.every((item) => typeof item === 'string')
    || typeof receipt.noOp !== 'boolean') {
    throw new Error('Contact merge planner returned an invalid receipt.');
  }
  return receipt as unknown as ContactMergePlanReceipt;
}
