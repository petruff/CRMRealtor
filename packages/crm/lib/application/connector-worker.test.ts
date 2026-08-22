import { describe, expect, it } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMemoryConnectorRepository } from '@/lib/data/memory-connector-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { approveConnectorIntentCommand, createConnectorIntentCommand } from './connector-commands';
import { ContractTestConnectorAdapter, drainConnectorJobs } from './connector-worker';

const configuration = loadConnectorRuntimeConfiguration({});
const liveScope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' as const };

async function queuedAction(actionType: 'test.succeed' | 'test.ambiguous') {
  const repository = createMemoryConnectorRepository({
    definitions: configuration.definitions,
    initialConnections: [{
      id: 'connection-contract-test', workspaceId: liveScope.workspaceId,
      provider: 'contract-test', remoteAccountId: 'contract-account',
      grantedScopes: ['test.succeed', 'test.ambiguous'], status: 'active',
      connectedAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
    }],
  });
  const now = new Date('2026-08-11T12:00:00.000Z');
  const intent = await createConnectorIntentCommand(repository, configuration, liveScope, {
    provider: 'contract-test', connectionId: 'connection-contract-test', actionType,
    payloadReference: `payload-${actionType}`, summary: 'Safe contract test.',
  }, now);
  const approved = await approveConnectorIntentCommand(repository, liveScope, {
    intentId: intent.id, expectedVersion: 1, idempotencyKey: `approve-${actionType}`, correlationId: `correlation-${actionType}`,
  }, now);
  return { repository, approved };
}

describe('connector worker', () => {
  it('persists attempt, accepted, and final receipts for the deterministic success path', async () => {
    const { repository, approved } = await queuedAction('test.succeed');
    const now = new Date('2026-08-11T12:00:01.000Z');
    const result = await drainConnectorJobs({
      repository, scope: liveScope, configuration,
      adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
      workerId: 'worker-a', now: () => now, random: () => 0.5,
    });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, deferred: 0 });
    const receipts = await repository.listReceipts(liveScope, { jobId: approved.job.id, limit: 100 });
    expect(receipts.map((event) => event.type)).toEqual(expect.arrayContaining([
      'attempt.started', 'provider.accepted', 'provider.final',
    ]));
    expect(await repository.getJob(liveScope, approved.job.id)).toMatchObject({ state: 'succeeded' });
  });

  it('reconciles an ambiguous provider outcome without executing it twice', async () => {
    const { repository, approved } = await queuedAction('test.ambiguous');
    let now = new Date('2026-08-11T12:00:01.000Z');
    let executeCount = 0;
    let reconcileCount = 0;
    const base = new ContractTestConnectorAdapter();
    const adapter = {
      provider: 'contract-test' as const,
      execute: async (job: Parameters<typeof base.execute>[0]) => { executeCount += 1; return base.execute(job); },
      reconcile: async (job: Parameters<typeof base.reconcile>[0]) => { reconcileCount += 1; return base.reconcile(job); },
    };
    const dependencies = {
      repository, scope: liveScope, configuration,
      adapters: new Map([['contract-test' as const, adapter]]),
      workerId: 'worker-a', now: () => now, random: () => 0.5,
    };
    expect(await drainConnectorJobs(dependencies)).toMatchObject({ deferred: 1, succeeded: 0 });
    now = new Date('2026-08-11T12:00:17.000Z');
    expect(await drainConnectorJobs(dependencies)).toMatchObject({ succeeded: 1, reconciled: 1 });
    expect({ executeCount, reconcileCount }).toEqual({ executeCount: 1, reconcileCount: 1 });
    const receipts = await repository.listReceipts(liveScope, { jobId: approved.job.id, limit: 100 });
    expect(receipts.map((event) => event.type)).toEqual(expect.arrayContaining([
      'provider.unknown', 'job.reconciled', 'provider.final',
    ]));
  });

  it('rejects sample/browser authority for the privileged worker', async () => {
    const repository = createMemoryConnectorRepository({ definitions: configuration.definitions });
    await expect(drainConnectorJobs({
      repository, scope: SAMPLE_WORKSPACE_SCOPE, configuration,
      adapters: new Map(), workerId: 'worker-a',
    })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
