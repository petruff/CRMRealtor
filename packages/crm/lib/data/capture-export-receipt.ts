import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { CaptureExportReceipt } from '../application/capture-outcome-export.ts';

export function captureExportReceiptWriter(client: SupabaseClient, scope: WorkspaceScope) {
  return async (receipt: CaptureExportReceipt): Promise<void> => {
    const { error } = await client.rpc('record_data_export_receipt', {
      target_workspace_id: scope.workspaceId, target_actor_membership_id: scope.membershipId,
      target_entity_type: 'capture-outcomes', target_format: 'json', target_selection: receipt.selection,
      target_selection_hash: receipt.selectionHash, target_row_count: 1, target_outcome: 'succeeded',
      target_correlation_id: receipt.correlationId, target_created_at: receipt.createdAt,
    });
    if (error) throw new Error('The review export receipt could not be recorded.');
  };
}
