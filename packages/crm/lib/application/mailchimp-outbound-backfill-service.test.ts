import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import type {
  MailchimpOutboundBackfillRepository,
  MailchimpOutboundBackfillRun,
} from '@/lib/data/mailchimp-outbound-backfill-repository';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';
import {
  approveMailchimpOutboundBackfillCommand,
  drainMailchimpOutboundBackfills,
  previewMailchimpOutboundBackfillCommand,
} from './mailchimp-outbound-backfill-service';

const configuration = {
  ...loadConnectorRuntimeConfiguration({}),
  definitions: loadConnectorRuntimeConfiguration({}).definitions.map((definition) => definition.provider === 'mailchimp'
    ? { ...definition, enabled: true, mode: 'uat' as const }
    : definition),
};
const liveScope: WorkspaceScope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' };
const run: MailchimpOutboundBackfillRun = {
  id: 'run-a', workspaceId: liveScope.workspaceId, connectionId: 'connection-a', bindingId: 'binding-a',
  mode: 'backfill', mappingVersion: 1, snapshotHash: 'a'.repeat(64), eligibleCount: 1, pageSize: 100,
  state: 'leased', nextOffset: 0, jobsEnqueued: 0, attemptCount: 0, maxAttempts: 10,
  correlationId: 'correlation-a', requestOrigin: 'owner', leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-12T12:05:00.000Z', fencingToken: 1, previewedAt: '2026-08-12T11:59:00.000Z',
};

function repository(): MailchimpOutboundBackfillRepository {
  const result: MailchimpOutboundBackfillRepository = {
    preview: vi.fn(async (_scope, input) => ({
      runId: 'run-a', workspaceId: liveScope.workspaceId, connectionId: input.connectionId,
      bindingId: 'binding-a', mode: input.mode, mappingVersion: 1, snapshotHash: 'a'.repeat(64),
      eligibleCount: 1, skippedUnlinkedCount: 0, skippedUnsubscribedCount: 0,
      pageSize: input.pageSize, containsRawEmails: false as const, noOp: false,
    })),
    approve: vi.fn(async () => ({ run: { ...run, state: 'approved' as const, leaseOwner: undefined, leaseExpiresAt: undefined }, noOp: false })),
    list: vi.fn(async () => []), scheduleDue: vi.fn(async () => []), claim: vi.fn(async () => [run]),
    start: vi.fn(async () => ({ ...run, state: 'executing' as const, attemptCount: 1 })),
    readPage: vi.fn(async () => ({
      run: { id: 'run-a', workspaceId: liveScope.workspaceId, connectionId: 'connection-a', bindingId: 'binding-a',
        mode: 'backfill' as const, snapshotHash: 'a'.repeat(64), mappingVersion: 1, pageSize: 100,
        eligibleCount: 1, nextOffset: 0, fencingToken: 1, leaseExpiresAt: '2026-08-12T12:05:00.000Z' },
      binding: { connectionId: 'connection-a', workspaceId: liveScope.workspaceId, bindingId: 'binding-a',
        dataCenter: 'us21', audienceId: 'audience-a', accountIdHash: 'b'.repeat(64), mappingVersion: 1 },
      offset: 0, items: [{ itemIndex: 0, operation: { audienceId: 'audience-a', subscriberHash: 'c'.repeat(32),
        desiredTag: 'Omnix: Hot' as const, mappingVersion: 1, operationKey: 'd'.repeat(64) } }],
      pageHash: 'e'.repeat(64), finalPage: true,
    })),
    enqueuePage: vi.fn(async () => ({ run: { ...run, state: 'executing' as const, nextOffset: 1, jobsEnqueued: 1, attemptCount: 1 },
      jobIds: ['job-a'], finalPage: true, noOp: false })),
    settle: vi.fn(async () => ({ run: { ...run, state: 'retry_wait' as const, nextOffset: 1, jobsEnqueued: 1,
      leaseOwner: undefined, leaseExpiresAt: undefined }, completed: false, noOp: false })),
    transition: vi.fn(async () => ({ ...run, state: 'retry_wait' as const, leaseOwner: undefined, leaseExpiresAt: undefined })),
  };
  return result;
}

describe('Mailchimp outbound backfill application service', () => {
  it('previews and approves only as a live owner without accepting contacts', async () => {
    const repo = repository();
    const preview = await previewMailchimpOutboundBackfillCommand(repo, configuration, liveScope, {
      connectionId: 'connection-a', requestKey: 'owner-click', pageSize: 100,
    }, new Date('2026-08-12T12:00:00.000Z'));
    expect(preview).toMatchObject({ eligibleCount: 1, containsRawEmails: false });
    await approveMailchimpOutboundBackfillCommand(repo, configuration, liveScope, {
      runId: preview.runId, snapshotHash: preview.snapshotHash, mappingVersion: preview.mappingVersion,
    }, new Date('2026-08-12T12:01:00.000Z'));
    expect(repo.approve).toHaveBeenCalledWith(liveScope, expect.objectContaining({ snapshotHash: 'a'.repeat(64) }));
  });

  it('encrypts a bounded page and leaves provider execution to standard jobs', async () => {
    const repo = repository();
    const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 4) };
    const result = await drainMailchimpOutboundBackfills({
      repository: repo, workerId: 'worker-a', batchSize: 5, leaseSeconds: 90,
      deadlineMs: new Date('2026-08-12T12:04:00.000Z').getTime(), resolver,
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    });
    expect(result).toMatchObject({ claimed: 1, pages: 1, jobsEnqueued: 1, deferred: 1 });
    expect(repo.enqueuePage).toHaveBeenCalledWith(expect.objectContaining({
      offset: 0,
      envelopes: [expect.objectContaining({
        operationKey: 'd'.repeat(64), envelope: expect.not.objectContaining({ ciphertext: expect.stringContaining('audience-a') }),
      })],
    }));
  });
});
