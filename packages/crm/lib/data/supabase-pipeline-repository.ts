import type { SupabaseClient } from '@supabase/supabase-js';
import { ActivityError } from '../domain/activity.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import { activityEventFromRow, type ActivityEventRow } from './supabase-activity-repository.ts';
import { contactFromRow, type ContactRow } from './supabase-repository.ts';
import type { PipelineRepository } from './pipeline-repository.ts';
import type { ContactIdentityMap } from './contact-identity-map.ts';

export function supabasePipelineRepository(
  client: SupabaseClient,
  identityMap?: ContactIdentityMap,
): PipelineRepository {
  return {
    async moveStage(untrustedScope, input) {
      const scope = validateWorkspaceScope(untrustedScope);
      if (scope.mode !== 'live') throw new ActivityError('scope-mismatch', 'Live pipeline requires live mode.');
      if (input.actorMembershipId !== scope.membershipId) {
        throw new ActivityError('forbidden', 'Actor does not match workspace membership.');
      }
      const canonicalContactId = identityMap
        ? await identityMap.resolveCanonical(scope, input.contactId)
        : input.contactId;
      const { data, error } = await client.rpc('move_contact_pipeline_stage', {
        target_workspace_id: scope.workspaceId,
        target_contact_id: canonicalContactId,
        target_from_stage: input.fromStage,
        target_to_stage: input.toStage,
        target_expected_updated_at: input.expectedUpdatedAt,
        target_actor_membership_id: scope.membershipId,
        target_occurred_at: input.occurredAt,
        target_idempotency_key: input.idempotencyKey,
      });
      if (error) {
        if (error.code === '42501') throw new ActivityError('forbidden', 'Pipeline move is not permitted.');
        if (error.code === '23505' || error.code === '40001') {
          throw new ActivityError('conflict', 'The contact changed. Refresh the pipeline and try again.');
        }
        if (error.code === '23514') throw new ActivityError('invalid-input', 'Pipeline move is invalid.');
        throw new Error('Pipeline move could not be persisted.');
      }
      const envelope = data as { contact?: ContactRow; event?: ActivityEventRow | null; noOp?: boolean };
      if (!envelope.contact || typeof envelope.noOp !== 'boolean') {
        throw new ActivityError('conflict', 'Pipeline move returned an invalid receipt.');
      }
      return {
        contact: contactFromRow(envelope.contact),
        ...(envelope.event ? { event: activityEventFromRow(envelope.event) } : {}),
        noOp: envelope.noOp,
      };
    },
  };
}
