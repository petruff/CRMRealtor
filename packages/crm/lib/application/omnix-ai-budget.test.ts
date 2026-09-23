import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { createSupabaseOmnixAiBudgetAuthority } from './omnix-ai-budget';

describe('createSupabaseOmnixAiBudgetAuthority', () => {
  it('binds reservation and finalization to the authenticated workspace scope', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { allowed: true, reservation_id: 'reservation-1' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const authority = createSupabaseOmnixAiBudgetAuthority({ rpc } as never, SAMPLE_WORKSPACE_SCOPE);
    await expect(authority.reserve({
      correlationId: 'correlation-1', policyVersion: 'omnix-ai-policy.v1', estimatedCostMicrousd: 2_000,
      perRunLimitMicrousd: 10_000, dailyLimitMicrousd: 1_000_000,
    })).resolves.toEqual({ allowed: true, reservationId: 'reservation-1' });
    await authority.finalize({
      reservationId: 'reservation-1', state: 'succeeded', inputTokens: 100, outputTokens: 20, actualCostMicrousd: 80,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, 'reserve_omnix_ai_budget', expect.objectContaining({
      target_workspace_id: SAMPLE_WORKSPACE_SCOPE.workspaceId,
      target_membership_id: SAMPLE_WORKSPACE_SCOPE.membershipId,
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_omnix_ai_budget', expect.objectContaining({
      target_reservation_id: 'reservation-1', target_state: 'succeeded',
    }));
  });

  it('fails closed when the durable RPC is unavailable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'missing migration' } });
    const authority = createSupabaseOmnixAiBudgetAuthority({ rpc } as never, SAMPLE_WORKSPACE_SCOPE);
    await expect(authority.reserve({
      correlationId: 'correlation-1', policyVersion: 'omnix-ai-policy.v1', estimatedCostMicrousd: 2_000,
      perRunLimitMicrousd: 10_000, dailyLimitMicrousd: 1_000_000,
    })).resolves.toEqual({ allowed: false, reason: 'unavailable' });
  });
});
