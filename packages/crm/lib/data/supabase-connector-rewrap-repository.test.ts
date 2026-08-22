import { describe, expect, it, vi } from 'vitest';
import { supabaseConnectorKekRewrapRepository } from './supabase-connector-rewrap-repository';

describe('Supabase connector KEK rewrap repository', () => {
  it('maps redacted candidates and sends replacement wrappers as bytea hex', async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'list_connector_kek_version_counts') return {
        data: [{ envelope_kind: 'payload', kek_version: 'v1', active_count: 2 }], error: null,
      };
      if (name === 'claim_connector_kek_rewrap_candidates') return { data: { candidates: [{
        claimId: 'claim-a', envelopeKind: 'payload', envelopeId: 'envelope-a',
        workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
        secretType: 'audience.sync', recordVersion: 1, sourceKekVersion: 'v1',
        targetKekVersion: 'v2', wrappedDek: Buffer.from('dek').toString('base64'),
        wrapNonce: Buffer.alloc(12, 1).toString('base64'),
        wrapAuthTag: Buffer.alloc(16, 2).toString('base64'), aadHash: 'a'.repeat(64),
        leaseExpiresAt: '2026-08-11T12:02:00.000Z', fencingToken: 4,
      }] }, error: null };
      return { data: { noOp: false }, error: null };
    });
    const repository = supabaseConnectorKekRewrapRepository({ rpc } as never);
    await expect(repository.listVersionCounts('2026-08-11T12:00:00.000Z')).resolves.toEqual([
      { envelopeKind: 'payload', kekVersion: 'v1', activeCount: 2 },
    ]);
    const [candidate] = await repository.claim({
      workerId: 'worker-a', sourceKekVersion: 'v1', targetKekVersion: 'v2',
      batchSize: 10, leaseSeconds: 90, now: '2026-08-11T12:00:00.000Z',
    });
    expect(candidate).toMatchObject({ provider: 'mailchimp', secretType: 'audience.sync', fencingToken: 4 });
    await expect(repository.complete({
      candidate: candidate!, workerId: 'worker-a', wrappedDek: Buffer.from('new-dek').toString('base64'),
      wrapNonce: Buffer.alloc(12, 3).toString('base64'), wrapAuthTag: Buffer.alloc(16, 4).toString('base64'),
      kekVersion: 'v2', aadHash: 'a'.repeat(64), now: '2026-08-11T12:00:01.000Z',
    })).resolves.toEqual({ noOp: false });
    expect(rpc).toHaveBeenLastCalledWith('cas_rewrap_connector_envelope', expect.objectContaining({
      target_wrapped_dek: `\\x${Buffer.from('new-dek').toString('hex')}`,
      target_wrap_nonce: `\\x${Buffer.alloc(12, 3).toString('hex')}`,
      target_wrap_auth_tag: `\\x${Buffer.alloc(16, 4).toString('hex')}`,
    }));
  });
});
