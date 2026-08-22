import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorKekRewrapRepository } from '../data/supabase-connector-rewrap-repository';
import { encryptConnectorSecret, createEnvironmentKekResolver } from '../security/connector-secret-envelope';
import { rewrapConnectorKekBatch } from './connector-kek-rewrap';

const aad = {
  workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
  secretType: 'oauth-token', recordVersion: 1,
} as const;

describe('connector KEK rewrap service', () => {
  it('rewraps only the DEK through a bounded claim and returns redacted counts', async () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    const oldResolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1', OMNIX_CONNECTOR_KEK_v1: oldKey,
    });
    const rotatingResolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v2',
      OMNIX_CONNECTOR_KEK_v1: oldKey, OMNIX_CONNECTOR_KEK_v2: newKey,
    });
    const encrypted = encryptConnectorSecret('never-return-provider-plaintext', aad, oldResolver);
    let counts = [{ envelopeKind: 'connection-secret' as const, kekVersion: 'v1', activeCount: 1 }];
    const complete = vi.fn(async (input: Parameters<ConnectorKekRewrapRepository['complete']>[0]) => {
      expect(input.wrappedDek).not.toBe(encrypted.encryptedDek);
      counts = [{ envelopeKind: 'connection-secret', kekVersion: 'v2', activeCount: 1 }];
      return { noOp: false };
    });
    const repository: ConnectorKekRewrapRepository = {
      listVersionCounts: async () => counts,
      claim: async () => [{
        claimId: 'claim-a', envelopeKind: 'connection-secret', envelopeId: 'envelope-a',
        ...aad, sourceKekVersion: 'v1', targetKekVersion: 'v2',
        wrappedDek: encrypted.encryptedDek, wrapNonce: encrypted.encryptedDekIv,
        wrapAuthTag: encrypted.encryptedDekTag, aadHash: encrypted.aadHash,
        leaseExpiresAt: '2026-08-11T12:02:00.000Z', fencingToken: 1,
      }],
      complete,
    };

    await expect(rewrapConnectorKekBatch({
      repository, resolver: rotatingResolver, workerId: 'worker-a', batchSize: 10,
      leaseSeconds: 90, now: () => new Date('2026-08-11T12:00:00.000Z'),
    })).resolves.toMatchObject({
      sourceKekVersion: 'v1', targetKekVersion: 'v2', claimed: 1,
      rewrapped: 1, noOp: 0, remaining: 0,
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('does not claim when every active envelope already uses the active key', async () => {
    const resolver = createEnvironmentKekResolver({
      OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v2',
      OMNIX_CONNECTOR_KEK_v2: randomBytes(32).toString('base64'),
    });
    const claim = vi.fn();
    const repository: ConnectorKekRewrapRepository = {
      listVersionCounts: async () => [{ envelopeKind: 'payload', kekVersion: 'v2', activeCount: 4 }],
      claim, complete: vi.fn(),
    };
    await expect(rewrapConnectorKekBatch({
      repository, resolver, workerId: 'worker-a', batchSize: 10, leaseSeconds: 90,
    })).resolves.toMatchObject({ claimed: 0, rewrapped: 0, remaining: 0 });
    expect(claim).not.toHaveBeenCalled();
  });
});
