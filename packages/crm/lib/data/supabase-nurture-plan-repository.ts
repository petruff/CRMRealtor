import type { SupabaseClient } from '@supabase/supabase-js';
import type { NurturePlan } from '../domain/nurture-plan.ts';
import type { NurturePlanAutomationRepository, NurturePlanRepository } from './nurture-plan-repository.ts';

interface Row {
  id: string; workspace_id: string; contact_id: string; source_proposal_id: string;
  state: NurturePlan['state']; version: number; cadence_days: number; current_step: number;
  maximum_steps: number; next_step_at: string | null; snoozed_until: string | null;
  stop_reason: string | null; created_at: string; updated_at: string;
  fencing_token: number;
}

const COLUMNS = 'id,workspace_id,contact_id,source_proposal_id,state,version,cadence_days,current_step,maximum_steps,next_step_at,snoozed_until,stop_reason,fencing_token,created_at,updated_at';

function plan(row: Row): NurturePlan {
  return {
    id: row.id, workspaceId: row.workspace_id, contactId: row.contact_id,
    sourceProposalId: row.source_proposal_id, state: row.state, version: row.version,
    cadenceDays: row.cadence_days, currentStep: row.current_step, maximumSteps: row.maximum_steps,
    ...(row.next_step_at ? { nextStepAt: row.next_step_at } : {}),
    ...(row.snoozed_until ? { snoozedUntil: row.snoozed_until } : {}),
    ...(row.stop_reason ? { stopReason: row.stop_reason } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function failure(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new Error(`${message}: access denied.`);
  if (error.code === 'P0002') return new Error(`${message}: not found.`);
  if (['23505', '23514', '40001'].includes(error.code ?? '')) return new Error(`${message}: state conflict.`);
  return new Error(`${message}: persistence failed.`);
}

export function supabaseNurturePlanRepository(client: SupabaseClient): NurturePlanRepository {
  return {
    async list(scope, input) {
      let query = client.from('omnix_nurture_plans').select(COLUMNS)
        .eq('workspace_id', scope.workspaceId).order('updated_at', { ascending: false }).limit(input.limit);
      if (input.contactId) query = query.eq('contact_id', input.contactId);
      const { data, error } = await query;
      if (error) throw failure('Failed to list nurture plans', error);
      return (data as unknown as Row[]).map(plan);
    },
    async get(scope, planId) {
      const { data, error } = await client.from('omnix_nurture_plans').select(COLUMNS)
        .eq('workspace_id', scope.workspaceId).eq('id', planId).maybeSingle();
      if (error) throw failure('Failed to load nurture plan', error);
      return data ? plan(data as unknown as Row) : undefined;
    },
    async create(scope, input) {
      const { data, error } = await client.rpc('create_omnix_nurture_plan', {
        target_workspace_id: scope.workspaceId, target_contact_id: input.contactId,
        target_source_proposal_id: input.sourceProposalId, target_cadence_days: input.cadenceDays,
        target_maximum_steps: input.maximumSteps, target_start_at: input.startAt,
        target_actor_membership_id: scope.membershipId, target_idempotency_key: input.idempotencyKey,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw failure('Failed to create nurture plan', error);
      return plan(data as unknown as Row);
    },
    async transition(scope, planId, input) {
      const { data, error } = await client.rpc('transition_omnix_nurture_plan', {
        target_workspace_id: scope.workspaceId, target_plan_id: planId,
        target_expected_version: input.expectedVersion, target_action: input.action,
        target_snoozed_until: input.snoozedUntil ?? null, target_stop_reason: input.stopReason ?? null,
        target_actor_membership_id: scope.membershipId, target_idempotency_key: input.idempotencyKey,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw failure('Failed to transition nurture plan', error);
      return plan(data as unknown as Row);
    },
  };
}

export function supabaseNurturePlanAutomationRepository(client: SupabaseClient): NurturePlanAutomationRepository {
  return {
    async claimDue(scope, input) {
      const { data, error } = await client.rpc('claim_due_omnix_nurture_plans', {
        target_workspace_id: scope.workspaceId, target_worker_id: input.workerId,
        target_now: input.now, target_lease_seconds: input.leaseSeconds, target_limit: input.limit,
      });
      if (error) throw failure('Failed to claim due nurture plans', error);
      return (data as unknown as Row[]).map((row) => ({ plan: plan(row), fencingToken: row.fencing_token }));
    },
    async completeStep(scope, input) {
      const { data, error } = await client.rpc('complete_omnix_nurture_step', {
        target_workspace_id: scope.workspaceId, target_plan_id: input.planId,
        target_worker_id: input.workerId, target_fencing_token: input.fencingToken,
        target_expected_version: input.expectedVersion, target_proposal_id: input.proposalId,
        target_idempotency_key: input.idempotencyKey, target_occurred_at: input.occurredAt,
      });
      if (error) throw failure('Failed to complete nurture step', error);
      return plan(data as unknown as Row);
    },
  };
}
