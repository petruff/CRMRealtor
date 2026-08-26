import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseGoogleOperationRepository } from './supabase-google-operation-repository.ts';

const capabilityState = {
  connection: {
    id: 'connection-a', workspaceId: 'workspace-a', status: 'active',
    displayLabel: 'Owner account', accountKeyHash: 'a'.repeat(64), grantedScopes: [],
  },
  capabilities: [], sync: [], calendar: { created: false }, tokenState: { refreshPresent: true },
};

describe('Supabase Google operation repository', () => {
  it('repairs capability projections through the bounded authenticated RPC', async () => {
    const rpc = vi.fn(async () => ({ data: capabilityState, error: null }));
    const repository = supabaseGoogleOperationRepository({
      authenticated: { rpc } as unknown as SupabaseClient,
    });

    await expect(repository.repairCapabilityState(
      {} as never,
      'connection-a',
      '2026-08-26T12:30:00.000Z',
    )).resolves.toMatchObject({ connection: { id: 'connection-a' } });
    expect(rpc).toHaveBeenCalledWith('repair_google_connection_capabilities', {
      target_connection_id: 'connection-a',
      target_occurred_at: '2026-08-26T12:30:00.000Z',
    });
  });

  it('fails closed when self-repair evidence is unavailable', async () => {
    const repository = supabaseGoogleOperationRepository({
      authenticated: {
        rpc: vi.fn(async () => ({ data: null, error: { code: 'P0002' } })),
      } as unknown as SupabaseClient,
    });

    await expect(repository.repairCapabilityState(
      {} as never,
      'connection-a',
      '2026-08-26T12:30:00.000Z',
    )).rejects.toMatchObject({ code: 'not-found' });
  });
});
