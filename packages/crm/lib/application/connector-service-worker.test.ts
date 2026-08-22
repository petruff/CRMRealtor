import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import type {
  ConnectorWorkerRepository,
  ConnectorWorkerTransition,
} from '@/lib/data/supabase-connector-worker-repository';
import { ConnectorError, type ConnectorJob } from '@/lib/domain/connector';
import { ContractTestConnectorAdapter } from './connector-worker';
import { drainConnectorServiceJobs } from './connector-service-worker';
import type { ConnectorRevocationRepository } from '@/lib/data/supabase-connector-revocation-repository';

const configuration = loadConnectorRuntimeConfiguration({});

function job(actionType: string, state: ConnectorJob['state'] = 'leased', fencingToken = 1): ConnectorJob {
  return {
    id: 'job-a', workspaceId: 'workspace-a', intentId: 'intent-a', intentVersion: 1,
    provider: 'contract-test', actionType, payloadReference: 'payload-a', idempotencyKey: 'key-a',
    correlationId: 'correlation-a', state, attemptCount: 0, maxAttempts: 5,
    scheduledAt: '2026-08-11T12:00:00.000Z', leaseOwner: 'worker-a',
    leaseExpiresAt: '2026-08-11T12:10:00.000Z', fencingToken,
    createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
  };
}

function repository(overrides: Partial<ConnectorWorkerRepository> = {}) {
  const transitions: ConnectorWorkerTransition[] = [];
  const value: ConnectorWorkerRepository = {
    claimJobs: async () => [],
    claimReconciliationJobs: async () => [],
    startAttempt: async ({ jobId }) => ({ ...job('test.succeed', 'executing'), id: jobId, attemptCount: 1 }),
    transition: async (input) => {
      transitions.push(input);
      return { ...job('test.succeed'), id: input.jobId, state: input.state === 'retry_wait'
        ? 'retry-scheduled' : input.state === 'reconciliation_required'
          ? 'reconciliation-required' : input.state === 'dead_letter' ? 'dead-letter' : input.state };
    },
    sweepExpired: async () => [],
    ...overrides,
  };
  return { value, transitions };
}

describe('server-only connector worker', () => {
  it('claims a bounded batch, starts an attempt, and transitions with an accepted provider receipt', async () => {
    const leased = job('test.succeed');
    const repo = repository({
      claimJobs: async () => [leased],
      startAttempt: async () => ({ ...leased, state: 'executing', attemptCount: 1 }),
    });
    const telemetry = vi.fn();
    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      configuration,
      adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
      workerId: 'worker-a',
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      random: () => 0.5,
      telemetry,
    });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, swept: 0 });
    expect(repo.transitions).toEqual([expect.objectContaining({
      state: 'succeeded', receiptType: 'provider.accepted', remoteOperationId: 'contract:job-a',
    })]);
    expect(telemetry).toHaveBeenCalledTimes(2);
  });

  it('routes an ambiguous result only through reconciliation on the next claim', async () => {
    const leased = job('test.ambiguous');
    const reconciliation = { ...leased, state: 'reconciliation-required' as const, fencingToken: 2 };
    let pass = 0;
    const repo = repository({
      claimJobs: async () => pass === 0 ? [leased] : [],
      claimReconciliationJobs: async () => pass === 1 ? [reconciliation] : [],
      startAttempt: async () => ({ ...leased, state: 'executing', attemptCount: 1 }),
    });
    const base = new ContractTestConnectorAdapter();
    const execute = vi.fn(base.execute.bind(base));
    const reconcile = vi.fn(base.reconcile.bind(base));
    const deps = {
      repository: repo.value, configuration,
      adapters: new Map([['contract-test' as const, { provider: 'contract-test' as const, execute, reconcile }]]),
      workerId: 'worker-a', now: () => new Date('2026-08-11T12:00:20.000Z'),
      random: () => 0.5, telemetry: vi.fn(),
    };
    expect(await drainConnectorServiceJobs(deps)).toMatchObject({ deferred: 1, succeeded: 0 });
    pass = 1;
    expect(await drainConnectorServiceJobs(deps)).toMatchObject({ reconciliationClaimed: 1, succeeded: 1 });
    expect(execute).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(repo.transitions).toEqual([
      expect.objectContaining({ state: 'reconciliation_required', receiptType: 'provider.unknown' }),
      expect.objectContaining({ state: 'succeeded', receiptType: 'reconciliation.resolved' }),
    ]);
  });

  it('starts a regular attempt before recording a missing-adapter configuration failure', async () => {
    const leased = job('test.succeed');
    const startAttempt = vi.fn(async () => ({ ...leased, state: 'executing' as const, attemptCount: 1 }));
    const repo = repository({
      claimJobs: async () => [leased],
      startAttempt,
    });
    const telemetry = vi.fn();

    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      configuration,
      adapters: new Map(),
      workerId: 'worker-a',
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry,
    });

    expect(startAttempt).toHaveBeenCalledOnce();
    expect(repo.transitions).toEqual([expect.objectContaining({
      state: 'failed', receiptType: 'provider.failed', errorCategory: 'configuration_required',
    })]);
    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    expect(telemetry).toHaveBeenCalledTimes(2);
  });

  it('skips a job when its lease is lost before the attempt starts', async () => {
    const leased = job('test.succeed');
    const repo = repository({
      claimJobs: async () => [leased],
      startAttempt: async () => {
        throw new ConnectorError('lease-lost', 'The lease moved to another worker.');
      },
    });

    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      configuration,
      adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
      workerId: 'worker-a',
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry: vi.fn(),
    });

    expect(repo.transitions).toHaveLength(0);
    expect(result).toMatchObject({ claimed: 1, succeeded: 0, deferred: 0, failed: 0 });
  });

  it('fails closed before creating a service client when privileged configuration is missing', async () => {
    const { drainConfiguredConnectorServiceJobs } = await import('./connector-service-worker');
    await expect(drainConfiguredConnectorServiceJobs({})).rejects.toMatchObject({ code: 'configuration-required' });
  });

  it('stops before another job or reconciliation claim once the runtime deadline is reached', async () => {
    const first = job('test.succeed');
    const second = { ...job('test.succeed'), id: 'job-b' };
    const reconciliation = { ...job('test.ambiguous', 'reconciliation-required'), id: 'job-c' };
    const started = new Date('2026-08-11T12:00:00.000Z').getTime();
    let tick = 0;
    const clock = () => new Date(started + (tick++ < 4 ? 0 : 6_000));
    const claimReconciliationJobs = vi.fn(async () => [reconciliation]);
    const repo = repository({
      claimJobs: async () => [first, second],
      claimReconciliationJobs,
      startAttempt: async ({ jobId }) => ({ ...first, id: jobId, state: 'executing', attemptCount: 1 }),
    });
    const boundedConfiguration = {
      ...configuration,
      worker: { ...configuration.worker, maxRuntimeSeconds: 5 },
    };

    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      configuration: boundedConfiguration,
      adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
      workerId: 'worker-a',
      now: clock,
      telemetry: vi.fn(),
    });

    expect(result).toMatchObject({ claimed: 2, reconciliationClaimed: 0, succeeded: 1 });
    expect(repo.transitions).toHaveLength(1);
    expect(repo.transitions[0]?.jobId).toBe('job-a');
    expect(claimReconciliationJobs).not.toHaveBeenCalled();
  });

  it('moves an exhausted retryable failure to dead letter without another schedule', async () => {
    const leased = { ...job('test.retryable'), attemptCount: 4, maxAttempts: 5 };
    const repo = repository({
      claimJobs: async () => [leased],
      startAttempt: async () => ({ ...leased, state: 'executing', attemptCount: 5 }),
    });
    const adapter = {
      provider: 'contract-test' as const,
      execute: vi.fn(async () => ({ outcome: 'retryable-failure' as const, errorCategory: 'provider_unavailable' as const })),
      reconcile: vi.fn(),
    };

    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      configuration,
      adapters: new Map([['contract-test', adapter]]),
      workerId: 'worker-a',
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry: vi.fn(),
    });

    expect(result).toMatchObject({ claimed: 1, failed: 1, deferred: 0 });
    expect(repo.transitions).toEqual([expect.objectContaining({
      state: 'dead_letter', receiptType: 'provider.failed', errorCategory: 'provider_unavailable',
    })]);
    expect(repo.transitions[0]).not.toHaveProperty('scheduledAt');
  });

  it('can run the server-only reconciliation queue without claiming normal jobs', async () => {
    const claimJobs = vi.fn(async () => [job('test.succeed')]);
    const reconciliation = { ...job('test.ambiguous', 'reconciliation-required'), fencingToken: 2 };
    const repo = repository({ claimJobs, claimReconciliationJobs: async () => [reconciliation] });
    const adapter = { provider: 'contract-test' as const, execute: vi.fn(), reconcile: vi.fn(async () => ({
      outcome: 'succeeded' as const, providerReceiptId: 'remote-a', providerStatus: 'reconciled',
    })) };

    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      configuration,
      adapters: new Map([['contract-test', adapter]]),
      workerId: 'worker-a',
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      reconciliationOnly: true,
      telemetry: vi.fn(),
    });

    expect(claimJobs).not.toHaveBeenCalled();
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(adapter.reconcile).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ claimed: 0, reconciliationClaimed: 1, succeeded: 1 });
  });

  it('drains revocations first and reports only aggregate evidence', async () => {
    const repo = repository();
    const revocation = {
      id: 'revocation-a', workspaceId: 'workspace-a', connectionId: 'connection-a',
      provider: 'contract-test' as const, state: 'leased' as const, attemptCount: 0, maxAttempts: 5,
      scheduledAt: '2026-08-11T12:00:00.000Z', leaseOwner: 'worker-a',
      leaseExpiresAt: '2026-08-11T12:02:00.000Z', fencingToken: 1,
      correlationId: 'correlation-a', connection: {
        id: 'connection-a', workspaceId: 'workspace-a', provider: 'contract-test' as const,
        remoteAccountId: 'remote-a', grantedScopes: [], status: 'revoking' as const,
        connectedAt: '2026-08-11T11:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
      },
    };
    const revocationRepository: ConnectorRevocationRepository = {
      claim: vi.fn(async () => [revocation]),
      start: vi.fn(async () => ({ ...revocation, state: 'executing' as const, attemptCount: 1 })),
      transition: vi.fn(async () => ({ ...revocation, state: 'succeeded' as const })),
      readSecret: vi.fn(),
    };
    const result = await drainConnectorServiceJobs({
      repository: repo.value,
      revocationRepository,
      configuration,
      adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
      workerId: 'worker-a',
      now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry: vi.fn(),
    });
    expect(result).toMatchObject({
      revocations: { claimed: 1, confirmed: 1, deferred: 0, unconfirmed: 0 },
    });
    expect(revocationRepository.transition).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'confirmed' }));
  });

  it('forwards lease-scoped Google secret decryption only to the revocation worker', async () => {
    const repo = repository();
    const revocation = {
      id: 'revocation-google', workspaceId: 'workspace-a', connectionId: 'connection-google',
      provider: 'google' as const, state: 'leased' as const, attemptCount: 0, maxAttempts: 5,
      scheduledAt: '2026-08-11T12:00:00.000Z', leaseOwner: 'worker-a',
      leaseExpiresAt: '2026-08-11T12:02:00.000Z', fencingToken: 1,
      correlationId: 'correlation-a', connection: {
        id: 'connection-google', workspaceId: 'workspace-a', provider: 'google' as const,
        remoteAccountId: 'remote-a', grantedScopes: [], status: 'revoking' as const,
        connectedAt: '2026-08-11T11:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
      },
    };
    const envelope = {
      secretId: 'secret-a', secretType: 'google-refresh-token', secretVersion: 1,
      ciphertext: 'cipher', nonce: 'nonce', authTag: 'tag', wrappedDek: 'wrapped',
      wrapNonce: 'wrap-nonce', wrapAuthTag: 'wrap-tag', kekVersion: 'v1', aadHash: 'a'.repeat(64),
    };
    const revocationRepository: ConnectorRevocationRepository = {
      claim: vi.fn(async () => [revocation]),
      start: vi.fn(async () => ({ ...revocation, state: 'executing' as const, attemptCount: 1 })),
      transition: vi.fn(async () => ({ ...revocation, state: 'succeeded' as const })),
      readSecret: vi.fn(async () => envelope),
    };
    const decryptRevocationSecret = vi.fn(async () => 'refresh-token');
    const revoke = vi.fn(async (_connection, token?: string) => token === 'refresh-token'
      ? { outcome: 'succeeded' as const, providerReceiptId: 'receipt-a', providerStatus: 'provider-confirmed' }
      : { outcome: 'terminal-failure' as const, errorCategory: 'configuration_required' as const });
    const result = await drainConnectorServiceJobs({
      repository: repo.value, revocationRepository, configuration,
      adapters: new Map([['google', { provider: 'google' as const, execute: vi.fn(), reconcile: vi.fn(), revoke }]]),
      workerId: 'worker-a', now: () => new Date('2026-08-11T12:00:01.000Z'),
      telemetry: vi.fn(), decryptRevocationSecret,
    });
    expect(result.revocations).toMatchObject({ confirmed: 1 });
    expect(revocationRepository.readSecret).toHaveBeenCalledWith(expect.objectContaining({
      secretType: 'google-refresh-token', fencingToken: 1,
    }));
    expect(decryptRevocationSecret).toHaveBeenCalledWith(expect.objectContaining({ id: 'revocation-google' }), envelope);
    expect(revoke).toHaveBeenCalledWith(expect.any(Object), 'refresh-token');
  });
});
