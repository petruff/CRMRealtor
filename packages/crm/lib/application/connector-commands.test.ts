import { describe, expect, it } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMemoryConnectorRepository } from '@/lib/data/memory-connector-repository';
import {
  SAMPLE_ASSISTANT_SCOPE,
  SAMPLE_WORKSPACE_SCOPE,
} from '@/lib/domain/workspace';
import {
  approveConnectorIntentCommand,
  createConnectorIntentCommand,
  disconnectConnectorCommand,
  editConnectorIntentCommand,
  probeConnectorConnectionCommand,
  rejectConnectorIntentCommand,
} from './connector-commands';

const configuration = loadConnectorRuntimeConfiguration({});
const now = new Date('2026-08-11T12:00:00.000Z');

function repository() {
  return createMemoryConnectorRepository({
    definitions: configuration.definitions,
    initialConnections: [{
      id: 'connection-contract-test', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
      provider: 'contract-test', remoteAccountId: 'contract-account',
      grantedScopes: ['test.succeed', 'test.ambiguous'], status: 'active',
      connectedAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
    }],
  });
}

describe('connector commands', () => {
  it('lets an assistant draft but only the owner approve one version exactly once', async () => {
    const store = repository();
    const draft = await createConnectorIntentCommand(store, configuration, SAMPLE_ASSISTANT_SCOPE, {
      provider: 'contract-test',
      connectionId: 'connection-contract-test',
      actionType: 'test.succeed',
      payloadReference: 'payload-1',
      payload: { safe: 'value' },
      summary: 'Send the approved contract-test action.',
    }, now);
    await expect(approveConnectorIntentCommand(store, SAMPLE_ASSISTANT_SCOPE, {
      intentId: draft.id,
      expectedVersion: 1,
      idempotencyKey: 'approve-1',
    }, now)).rejects.toMatchObject({ code: 'forbidden' });

    const approved = await approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: draft.id,
      expectedVersion: 1,
      idempotencyKey: 'approve-1',
      correlationId: 'correlation-1',
    }, now);
    const replay = await approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: draft.id,
      expectedVersion: 1,
      idempotencyKey: 'approve-1',
      correlationId: 'correlation-1',
    }, now);
    expect(approved).toMatchObject({ noOp: false, job: { state: 'queued', intentVersion: 1 } });
    expect(replay).toMatchObject({ noOp: true, job: { id: approved.job.id } });
    expect(await store.listJobs(SAMPLE_WORKSPACE_SCOPE, { limit: 100 })).toHaveLength(1);
  });

  it('rejects provider approval from a support grant with a forged owner role', async () => {
    const store = repository();
    const draft = await createConnectorIntentCommand(store, configuration, SAMPLE_ASSISTANT_SCOPE, {
      provider: 'contract-test', connectionId: 'connection-contract-test',
      actionType: 'test.succeed', payloadReference: 'payload-support', summary: 'Support draft.',
    }, now);
    await expect(approveConnectorIntentCommand(store, {
      ...SAMPLE_ASSISTANT_SCOPE,
      role: 'owner',
      supportGrant: { active: true },
    }, {
      intentId: draft.id, expectedVersion: 1, idempotencyKey: 'support-approval',
    }, now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await store.listJobs(SAMPLE_WORKSPACE_SCOPE, { limit: 100 })).toHaveLength(0);
  });

  it('rejects a pending intent without creating a provider job', async () => {
    const store = repository();
    const draft = await createConnectorIntentCommand(store, configuration, SAMPLE_WORKSPACE_SCOPE, {
      provider: 'contract-test', actionType: 'test.succeed', payloadReference: 'payload-2', summary: 'Reject me.',
      connectionId: 'connection-contract-test',
    }, now);
    await rejectConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: draft.id, expectedVersion: 1, correlationId: 'reject-1',
    }, now);
    expect(await store.listJobs(SAMPLE_WORKSPACE_SCOPE, { limit: 100 })).toHaveLength(0);
    expect(await store.listReceipts(SAMPLE_WORKSPACE_SCOPE, { intentId: draft.id, limit: 100 }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'intent.rejected' })]));
  });

  it('fails closed for disabled providers and unallowlisted actions', async () => {
    const store = repository();
    await expect(createConnectorIntentCommand(store, configuration, SAMPLE_WORKSPACE_SCOPE, {
      provider: 'mailchimp', actionType: 'audience.sync', payloadReference: 'payload-3', summary: 'No live claim.',
      connectionId: 'connection-contract-test',
    }, now)).rejects.toMatchObject({ code: 'provider-disabled' });
    await expect(createConnectorIntentCommand(store, configuration, SAMPLE_WORKSPACE_SCOPE, {
      provider: 'contract-test', actionType: 'mail.send', payloadReference: 'payload-4', summary: 'No arbitrary action.',
      connectionId: 'connection-contract-test',
    }, now)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects stale approval versions, divergent replay keys, and cross-workspace reads', async () => {
    const store = repository();
    const draft = await createConnectorIntentCommand(store, configuration, SAMPLE_WORKSPACE_SCOPE, {
      provider: 'contract-test', actionType: 'test.succeed', payloadReference: 'payload-5', summary: 'Versioned action.',
      connectionId: 'connection-contract-test',
    }, now);
    await expect(approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: draft.id, expectedVersion: 2, idempotencyKey: 'approve-versioned',
    }, now)).rejects.toMatchObject({ code: 'conflict' });
    await approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: draft.id, expectedVersion: 1, idempotencyKey: 'approve-versioned',
    }, now);
    await expect(approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: draft.id, expectedVersion: 2, idempotencyKey: 'approve-versioned',
    }, now)).rejects.toMatchObject({ code: 'conflict' });
    const otherWorkspace = { ...SAMPLE_WORKSPACE_SCOPE, workspaceId: 'workspace-other' };
    await expect(store.listJobs(otherWorkspace, { limit: 100 })).resolves.toEqual([]);
    await expect(store.getJob(otherWorkspace, 'connector-job-0001')).resolves.toBeUndefined();
  });

  it('requires a fresh approval after an intent is edited', async () => {
    const store = repository();
    const draft = await createConnectorIntentCommand(store, configuration, SAMPLE_ASSISTANT_SCOPE, {
      provider: 'contract-test', actionType: 'test.succeed', payloadReference: 'payload-original',
      summary: 'Original summary.', connectionId: 'connection-contract-test',
    }, now);
    const edited = await editConnectorIntentCommand(store, SAMPLE_ASSISTANT_SCOPE, {
      intentId: draft.id, expectedVersion: 1, payloadReference: 'payload-revised',
      summary: 'Revised summary.', correlationId: 'edit-correlation',
    }, now);
    expect(edited).toMatchObject({ version: 2, status: 'pending', payloadReference: 'payload-revised' });
    await expect(approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: edited.id, expectedVersion: 1, idempotencyKey: 'stale-edit-approval',
    }, now)).rejects.toMatchObject({ code: 'conflict' });
    await expect(approveConnectorIntentCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      intentId: edited.id, expectedVersion: 2, idempotencyKey: 'fresh-edit-approval',
    }, now)).resolves.toMatchObject({ noOp: false, job: { intentVersion: 2 } });
  });

  it('queues two-phase revocation once and returns a safe replay receipt', async () => {
    const store = repository();
    const first = await disconnectConnectorCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      connectionId: 'connection-contract-test', correlationId: 'disconnect-confirmed',
    }, now);
    const replay = await disconnectConnectorCommand(store, SAMPLE_WORKSPACE_SCOPE, {
      connectionId: 'connection-contract-test', correlationId: 'disconnect-replay',
    }, now);

    expect(first).toMatchObject({
      noOp: false,
      connection: { status: 'revoking' },
      receipt: { type: 'revocation.requested', correlationId: 'disconnect-confirmed' },
    });
    expect(replay).toMatchObject({
      noOp: true,
      connection: { status: 'revoking' },
      receipt: { type: 'revocation.requested', correlationId: 'disconnect-replay' },
    });
  });

  it('reports the deterministic connection probe as unsupported instead of faking provider health', async () => {
    await expect(probeConnectorConnectionCommand(
      repository(), configuration, SAMPLE_WORKSPACE_SCOPE,
      { connectionId: 'connection-contract-test' },
    )).resolves.toEqual({
      supported: false,
      state: 'probe-unsupported',
      provider: 'contract-test',
      connectionId: 'connection-contract-test',
    });
  });
});
