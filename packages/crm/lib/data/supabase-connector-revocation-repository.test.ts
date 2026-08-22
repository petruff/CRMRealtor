import { describe, expect, it, vi } from 'vitest';
import { supabaseConnectorRevocationRepository } from './supabase-connector-revocation-repository';

const connection = {
  id: 'connection-a', workspace_id: 'workspace-a', provider: 'contract-test',
  provider_account_key_hash: 'a'.repeat(64), display_label: 'Contract account',
  status: 'revoking', granted_scopes: ['contract.execute'], last_probe_at: null,
  created_at: '2026-08-11T12:00:00.000Z', updated_at: '2026-08-11T12:00:00.000Z',
  disconnected_at: null,
};

const job = {
  id: 'revocation-a', workspaceId: 'workspace-a', connectionId: 'connection-a',
  provider: 'contract-test', state: 'leased', attemptCount: 0, maxAttempts: 5,
  scheduledAt: '2026-08-11T12:00:00.000Z', leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-11T12:02:00.000Z', fencingToken: '3',
  correlationId: 'correlation-a', connection,
};

describe('Supabase connector revocation repository', () => {
  it('maps leased authority and sends a fenced confirmed transition', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_connector_revocation_jobs') return { data: { count: 1, jobs: [job] }, error: null };
      if (name === 'start_connector_revocation_attempt') return {
        data: { revocationJob: { ...job, state: 'executing', attemptCount: 1 }, connection, noOp: false }, error: null,
      };
      return {
        data: { revocationJob: { ...job, state: 'succeeded', attemptCount: 1 }, connection: {
          ...connection, status: 'disconnected', disconnected_at: '2026-08-11T12:00:03.000Z',
        }, noOp: false }, error: null,
      };
    });
    const repository = supabaseConnectorRevocationRepository({ rpc } as never);
    const [claimed] = await repository.claim({
      workerId: 'worker-a', batchSize: 10, leaseSeconds: 90, now: '2026-08-11T12:00:01.000Z',
    });
    expect(claimed).toMatchObject({ state: 'leased', fencingToken: 3, connection: { status: 'revoking' } });
    const started = await repository.start({
      jobId: claimed!.id, workerId: 'worker-a', fencingToken: claimed!.fencingToken,
      startedAt: '2026-08-11T12:00:02.000Z',
    });
    expect(started).toMatchObject({ state: 'executing', attemptCount: 1 });
    await repository.transition({
      jobId: started.id, workerId: 'worker-a', fencingToken: started.fencingToken,
      outcome: 'confirmed', evidence: { confirmationKind: 'provider-confirmed', providerStatus: 'revoked' },
      transitionedAt: '2026-08-11T12:00:03.000Z',
    });
    expect(rpc).toHaveBeenLastCalledWith('transition_connector_revocation_job', expect.objectContaining({
      target_outcome: 'confirmed', target_fencing_token: 3,
      target_evidence: { confirmationKind: 'provider-confirmed', providerStatus: 'revoked' },
    }));
  });

  it('reads only an encrypted envelope through the active lease', async () => {
    const rpc = vi.fn(async () => ({ data: {
      secretId: 'secret-a', secretType: 'oauth-refresh-token', secretVersion: 2,
      ciphertext: 'Y2lwaGVydGV4dA==', nonce: 'bm9uY2U=', authTag: 'dGFn',
      wrappedDek: 'ZGVr', wrapNonce: 'd3JhcC1ub25jZQ==', wrapAuthTag: 'd3JhcC10YWc=',
      kekVersion: 'v2', aadHash: 'b'.repeat(64), expiresAt: null,
    }, error: null }));
    const repository = supabaseConnectorRevocationRepository({ rpc } as never);
    const envelope = await repository.readSecret({
      jobId: 'revocation-a', workerId: 'worker-a', fencingToken: 3,
      secretType: 'oauth-refresh-token', now: '2026-08-11T12:00:02.000Z',
    });
    expect(envelope).toMatchObject({ secretId: 'secret-a', secretVersion: 2, kekVersion: 'v2' });
    expect(JSON.stringify(envelope)).not.toContain('access_token');
  });
});
