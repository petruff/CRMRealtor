import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixAiBudgetAuthority } from './omnix-generative-narrator.ts';

interface ReservationRow {
  allowed?: boolean;
  reservation_id?: string;
  reason?: string;
}
function firstRecord(value: unknown): ReservationRow | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' ? candidate as ReservationRow : undefined;
}

export function createSupabaseOmnixAiBudgetAuthority(
  client: SupabaseClient,
  scope: WorkspaceScope,
): OmnixAiBudgetAuthority {
  return {
    async reserve(input) {
      const { data, error } = await client.rpc('reserve_omnix_ai_budget', {
        target_workspace_id: scope.workspaceId,
        target_membership_id: scope.membershipId,
        target_correlation_id: input.correlationId,
        target_policy_version: input.policyVersion,
        target_estimated_microusd: input.estimatedCostMicrousd,
        target_per_run_limit_microusd: input.perRunLimitMicrousd,
        target_daily_limit_microusd: input.dailyLimitMicrousd,
      });
      if (error) return { allowed: false, reason: 'unavailable' };
      const row = firstRecord(data);
      if (row?.allowed && typeof row.reservation_id === 'string') {
        return { allowed: true, reservationId: row.reservation_id };
      }
      return { allowed: false, reason: row?.reason === 'exhausted' ? 'exhausted' : 'unavailable' };
    },
    async finalize(input) {
      const { error } = await client.rpc('finalize_omnix_ai_budget', {
        target_workspace_id: scope.workspaceId,
        target_membership_id: scope.membershipId,
        target_reservation_id: input.reservationId,
        target_state: input.state,
        target_input_tokens: input.inputTokens,
        target_output_tokens: input.outputTokens,
        target_actual_microusd: input.actualCostMicrousd,
        target_error_category: input.errorCategory ?? null,
      });
      if (error) throw new Error('Omnix AI budget receipt could not be finalized.');
    },
  };
}
