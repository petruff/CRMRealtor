import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import type {
  ConnectorRevocationJob,
  ConnectorRevocationRepository,
  ConnectorRevocationTransition,
} from '@/lib/data/supabase-connector-revocation-repository';
import { ContractTestConnectorAdapter } from './connector-worker';
import { drainConnectorRevocations } from './connector-revocation-worker';

const configuration = loadConnectorRuntimeConfiguration({});

function revocation(overrides: Partial<ConnectorRevocationJob> = {}): ConnectorRevocationJob {
  return {
    id: 'revocation-a', workspaceId: 'workspace-a', connectionId: 'connection-a',
    provider: 'contract-test', state: 'leased', attemptCount: 0, maxAttempts: 5,
    scheduledAt: '2026-08-11T12:00:00.000Z', leaseOwner: 'worker-a',
    leaseExpiresAt: '2026-08-11T12:02:00.000Z', fencingToken: 2,
    correlationId: 'correlation-a', connection: {
      id: 'connection-a', workspaceId: 'workspace-a', provider: 'contract-test',
      remoteAccountId: 'remote-a', remoteAccountLabel: 'Contract account', grantedScopes: [],
      status: 'revoking', connectedAt: '2026-08-11T11:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
    },
    ...overrides,
  };
}

function repository(job = revocation()) {
  const transitions: ConnectorRevocationTransition[] = [];
  const value: ConnectorRevocationRepository = {
    claim: vi.fn(async () => [job]),
    start: vi.fn(async () => ({ ...job, state: 'executing' as const, attemptCount: job.attemptCount + 1 })),
    transition: vi.fn(async (input) => {
      transitions.push(input);
      return {
        ...job,
        state: input.outcome === 'confirmed' ? 'succeeded' as const : 'retry-wait' as const,
      };
    }),
    readSecret: vi.fn(),
  };
  return { value, transitions };
}

describe('connector revocation worker', () => {
  it('requires provider confirmation before recording a disconnected connection', async () => {
    const repo = repository();
    const telemetry = vi.fn();
    const result = await drainConnectorRevocations({
      repository: repo.value,
      configuration,
      adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
      workerId: 'worker-a',
      deadlineMs: new Date('2026-08-11T12:01:00.000Z').getTime(),
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry,
    });
    expect(result).toEqual({ claimed: 1, confirmed: 1, deferred: 0, unconfirmed: 0 });
    expect(repo.transitions).toEqual([expect.objectContaining({
      outcome: 'confirmed',
      evidence: expect.objectContaining({ confirmationKind: 'provider-confirmed', providerStatus: 'revoked' }),
    })]);
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ event: 'worker.revocation-finished' }));
  });

  it('ends without claiming once the shared runtime deadline has elapsed', async () => {
    const repo = repository();
    const result = await drainConnectorRevocations({
      repository: repo.value,
      configuration,
      adapters: new Map(),
      workerId: 'worker-a',
      deadlineMs: new Date('2026-08-11T12:00:00.000Z').getTime(),
      now: () => new Date('2026-08-11T12:00:01.000Z'),
    });
    expect(result).toEqual({ claimed: 0, confirmed: 0, deferred: 0, unconfirmed: 0 });
    expect(repo.value.claim).not.toHaveBeenCalled();
  });

  it('fails closed as unconfirmed when no provider revocation adapter exists', async () => {
    const repo = repository();
    const result = await drainConnectorRevocations({
      repository: repo.value,
      configuration,
      adapters: new Map(),
      workerId: 'worker-a',
      deadlineMs: new Date('2026-08-11T12:01:00.000Z').getTime(),
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry: vi.fn(),
    });
    expect(result).toMatchObject({ unconfirmed: 1, confirmed: 0 });
    expect(repo.transitions).toEqual([expect.objectContaining({
      outcome: 'terminal', errorCategory: 'configuration_required',
    })]);
  });

  it('keeps no-endpoint providers disconnected-unconfirmed pending manual revocation', async () => {
    const repo = repository(revocation({ provider: 'mailchimp', connection: {
      ...revocation().connection, provider: 'mailchimp',
    } }));
    const adapter = {
      provider: 'mailchimp' as const,
      execute: vi.fn(), reconcile: vi.fn(),
      revoke: vi.fn(async () => ({
        outcome: 'succeeded' as const,
        providerReceiptId: 'mailchimp-no-revocation-endpoint',
        providerStatus: 'no-revocation-endpoint',
      })),
    };
    const result = await drainConnectorRevocations({
      repository: repo.value, configuration, adapters: new Map([['mailchimp', adapter]]),
      workerId: 'worker-a', deadlineMs: new Date('2026-08-11T12:01:00.000Z').getTime(),
      now: () => new Date('2026-08-11T12:00:01.000Z'), telemetry: vi.fn(),
    });
    expect(result).toMatchObject({ confirmed: 0, unconfirmed: 1 });
    expect(repo.transitions).toEqual([expect.objectContaining({
      outcome: 'terminal',
      errorCategory: 'configuration_required',
      evidence: { reasonCode: 'manual-provider-revocation-required' },
    })]);
  });

  it('schedules an unknown provider outcome instead of cryptoshredding early', async () => {
    const repo = repository(revocation({ attemptCount: 1 }));
    const adapter = {
      provider: 'contract-test' as const,
      execute: vi.fn(), reconcile: vi.fn(),
      revoke: vi.fn(async () => ({
        outcome: 'unknown' as const, errorCategory: 'network_outcome_unknown' as const,
      })),
    };
    const result = await drainConnectorRevocations({
      repository: repo.value,
      configuration,
      adapters: new Map([['contract-test', adapter]]),
      workerId: 'worker-a',
      deadlineMs: new Date('2026-08-11T12:01:00.000Z').getTime(),
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      random: () => 0.5,
      telemetry: vi.fn(),
    });
    expect(result).toMatchObject({ deferred: 1, confirmed: 0 });
    expect(repo.transitions).toEqual([expect.objectContaining({
      outcome: 'unknown', errorCategory: 'network_outcome_unknown',
      nextAttemptAt: expect.any(String),
    })]);
  });

  it('decrypts a lease-scoped Google refresh token before invoking provider revocation', async () => {
    const googleJob = revocation({ provider: 'google', connection: {
      ...revocation().connection, provider: 'google',
    } });
    const repo = repository(googleJob);
    repo.value.readSecret = vi.fn(async () => ({
      secretId: 'secret-a', secretType: 'google-refresh-token', secretVersion: 1,
      ciphertext: 'YQ==', nonce: 'YQ==', authTag: 'YQ==', wrappedDek: 'YQ==',
      wrapNonce: 'YQ==', wrapAuthTag: 'YQ==', kekVersion: 'k1', aadHash: 'a'.repeat(64),
    }));
    const revoke = vi.fn(async (_connection, token) => ({
      outcome: 'succeeded' as const, providerReceiptId: 'google-revoked', providerStatus: token === 'refresh-token'
        ? 'provider-confirmed' : 'invalid',
    }));
    const result = await drainConnectorRevocations({
      repository: repo.value, configuration,
      adapters: new Map([['google', { provider: 'google', execute: vi.fn(), reconcile: vi.fn(), revoke }]]),
      workerId: 'worker-a', deadlineMs: new Date('2026-08-11T12:01:00.000Z').getTime(),
      now: () => new Date('2026-08-11T12:00:01.000Z'), telemetry: vi.fn(),
      decryptRevocationSecret: () => 'refresh-token',
    });
    expect(result.confirmed).toBe(1);
    expect(repo.value.readSecret).toHaveBeenCalledWith(expect.objectContaining({ secretType: 'google-refresh-token' }));
    expect(revoke).toHaveBeenCalledWith(expect.any(Object), 'refresh-token');
  });
});
