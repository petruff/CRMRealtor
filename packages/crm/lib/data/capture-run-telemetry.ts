import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { CaptureRunTelemetry } from '../domain/capture-run-telemetry.ts';

export async function recordCaptureRunTelemetry(client: SupabaseClient, scope: WorkspaceScope, contactId: string, data: CaptureRunTelemetry): Promise<void> {
  const { error } = await client.from('capture_run_telemetry').insert({
    workspace_id: scope.workspaceId, actor_membership_id: scope.membershipId, contact_id: contactId,
    correlation_id: data.correlationId, source_hash: data.sourceHash, state: data.state, reason: data.reason,
    policy_version: data.policyVersion, model: data.model ?? null, reservation_id: data.reservationId ?? null,
    duration_ms: data.durationMs, estimated_input_tokens: data.estimatedInputTokens,
    reserved_output_tokens: data.reservedOutputTokens, charged_upper_bound_microusd: data.chargedUpperBoundMicrousd,
    accounting: data.accounting,
  });
  if (error) throw new Error('Capture run metadata could not be recorded.');
}
