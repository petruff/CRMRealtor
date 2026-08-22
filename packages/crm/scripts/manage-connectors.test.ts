import { describe, expect, it } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { ContractTestConnectorAdapter, drainConnectorJobs } from '@/lib/application/connector-worker';
import { createMemoryConnectorRepository } from '@/lib/data/memory-connector-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { createSampleConnectorCliContext, runConnectorCli } from './manage-connectors';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: (value: string) => { stdout += value; },
    stderr: (value: string) => { stderr += value; },
    output: () => ({ stdout, stderr }),
  };
}

describe('connector CLI', () => {
  it('lists explicit provider-disabled definitions without secret-like output', async () => {
    const io = capture();
    expect(await runConnectorCli(['definitions'], io)).toBe(0);
    const envelope = JSON.parse(io.output().stdout);
    expect(envelope).toMatchObject({
      ok: true,
      schemaVersion: 'crm-work-queue-cli.v1',
      mode: 'sample-process-only',
      durable: false,
      resource: 'connectors',
    });
    expect(envelope.result).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'mailchimp', enabled: false, mode: 'provider-disabled' }),
    ]));
    expect(io.output().stdout).not.toMatch(/access.token|refresh.token|client.secret|password/i);
  });

  it('proves draft, atomic approve/enqueue, and bounded drain through one injected context', async () => {
    const configuration = loadConnectorRuntimeConfiguration({});
    const context = {
      repository: createMemoryConnectorRepository({
        definitions: configuration.definitions,
        initialConnections: [{
          id: 'connection-contract-test', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
          provider: 'contract-test', remoteAccountId: 'contract-account',
          grantedScopes: ['test.succeed'], status: 'active',
          connectedAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
        }],
      }),
      scope: { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' as const },
      configuration,
    };
    const now = new Date('2026-08-11T12:00:00.000Z');
    const liveContext = async () => context;
    const draftIo = capture();
    expect(await runConnectorCli([
      'draft', '--live', '--provider', 'contract-test', '--action', 'test.succeed',
      '--connection-id', 'connection-contract-test',
      '--payload-ref', 'payload-1', '--summary', 'Contract proof',
    ], { ...draftIo, liveContext, now: () => now })).toBe(0);
    const intentId = JSON.parse(draftIo.output().stdout).result.id;

    const approveIo = capture();
    expect(await runConnectorCli([
      'enqueue', '--live', '--intent-id', intentId, '--expected-version', '1',
      '--idempotency-key', 'approve-1', '--correlation-id', 'correlation-1',
    ], { ...approveIo, liveContext, now: () => now })).toBe(0);
    expect(JSON.parse(approveIo.output().stdout).result).toMatchObject({ noOp: false, job: { state: 'queued' } });

    const drainIo = capture();
    expect(await runConnectorCli(['drain', '--live'], {
      ...drainIo,
      privilegedDrain: async () => drainConnectorJobs({
        repository: context.repository,
        scope: context.scope,
        configuration,
        adapters: new Map([['contract-test', new ContractTestConnectorAdapter()]]),
        workerId: 'cli-drain',
        now: () => new Date('2026-08-11T12:00:01.000Z'),
        random: () => 0.5,
      }),
    })).toBe(0);
    expect(JSON.parse(drainIo.output().stdout).result).toMatchObject({ claimed: 1, succeeded: 1 });
  });

  it('fails closed when live authority and migrated repository are unavailable', async () => {
    const io = capture();
    expect(await runConnectorCli(['connections', '--live'], io)).not.toBe(0);
    const envelope = JSON.parse(io.output().stderr);
    expect(envelope).toMatchObject({ ok: false, mode: 'live-authenticated', durable: true });
    expect(envelope.message).toMatch(/Live mode refused|access token is invalid|expired/i);
  });

  it('keeps sample disconnect state non-durable and redacted', async () => {
    const context = createSampleConnectorCliContext();
    const io = capture();
    expect(await runConnectorCli([
      'disconnect', '--connection-id', 'connection-contract-test',
    ], { ...io, sampleContext: () => context, now: () => new Date('2026-08-11T12:00:00Z') })).toBe(0);
    expect(JSON.parse(io.output().stdout)).toMatchObject({
      durable: false,
      result: { connection: { status: 'revoking' }, receipt: { type: 'revocation.requested' } },
    });
  });

  it('reports an honest unsupported sample probe without simulated provider health', async () => {
    const io = capture();
    expect(await runConnectorCli([
      'probe', '--connection-id', 'connection-contract-test',
    ], io)).toBe(0);
    expect(JSON.parse(io.output().stdout)).toMatchObject({
      mode: 'sample-process-only', durable: false,
      result: { supported: false, state: 'probe-unsupported', provider: 'contract-test' },
    });
  });

  it('routes privileged live drain, reconciliation, and rewrap without an end-user context', async () => {
    const calls: unknown[] = [];
    const privilegedDrain = async (options?: { readonly reconciliationOnly?: boolean }) => {
      calls.push(options ?? {});
      return { claimed: options?.reconciliationOnly ? 0 : 1, reconciliationClaimed: options?.reconciliationOnly ? 1 : 0 };
    };
    const privilegedRewrap = async () => ({ scanned: 4, rewrapped: 3, remaining: 1 });
    for (const command of ['drain', 'reconcile', 'rewrap'] as const) {
      const io = capture();
      expect(await runConnectorCli([command, '--live'], { ...io, privilegedDrain, privilegedRewrap })).toBe(0);
      expect(JSON.parse(io.output().stdout)).toMatchObject({
        ok: true, mode: 'live-server-only', durable: true, command,
      });
    }
    expect(calls).toEqual([expect.objectContaining({ reconciliationOnly: false }), { reconciliationOnly: true }]);
  });

  it('fails a privileged operation closed with a server-only envelope', async () => {
    const io = capture();
    expect(await runConnectorCli(['rewrap', '--live'], {
      ...io,
      privilegedRewrap: async () => { throw new Error('rotation unavailable'); },
    })).toBe(1);
    expect(JSON.parse(io.output().stderr)).toMatchObject({
      ok: false, mode: 'live-server-only', durable: true, code: 'internal-error',
    });
  });
});
