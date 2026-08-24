import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import type { MailchimpReconciliationRepository, MailchimpReconciliationRun } from '@/lib/data/supabase-mailchimp-reconciliation-repository';
import { encryptConnectorSecret } from '@/lib/security/connector-secret-envelope';
import {
  drainMailchimpReconciliationRuns,
  requestAndDrainMailchimpReconciliationCommand,
} from './mailchimp-reconciliation-service';

const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 9) };
const configuration = loadConnectorRuntimeConfiguration({});
const baseRun: MailchimpReconciliationRun = {
  id: 'run-a', workspaceId: 'workspace-a', connectionId: 'connection-a', bindingId: 'binding-a',
  mode: 'baseline', state: 'leased', snapshotHash: 'a'.repeat(64), pageSize: 1,
  nextOffset: 0, pagesApplied: 0, itemsSeen: 0, itemsApplied: 0, itemsReviewed: 0,
  itemsBlocked: 0, attemptCount: 0, maxAttempts: 5, fencingToken: 1,
  leaseOwner: 'worker-a', correlationId: 'correlation-a',
};

function repository() {
  const applyPage = vi.fn(async ({ run }: { run: MailchimpReconciliationRun }) => ({
    run: { ...run, nextOffset: 1, providerTotal: 1, pagesApplied: 1, itemsSeen: 1, itemsApplied: 1 },
    finalPage: true,
    noOp: false,
  }));
  const value: MailchimpReconciliationRepository = {
    request: vi.fn(), list: vi.fn(), claim: vi.fn(async () => [baseRun]),
    start: vi.fn(async ({ run }) => ({ ...run, state: 'executing' as const, attemptCount: 1 })),
    readAuthority: vi.fn(async ({ run }) => ({
      run, dataCenter: 'us21', audienceId: 'audience-a', mappingVersion: 1, secretVersion: 1,
      accessTokenEnvelope: encryptConnectorSecret('token-a', {
        workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
        secretType: 'mailchimp-access-token', recordVersion: 1,
      }, resolver),
    })),
    applyPage,
    complete: vi.fn(async ({ run }) => ({ ...run, state: 'succeeded' as const })),
    transition: vi.fn(async ({ run, outcome }) => ({ ...run, state: outcome === 'retry' ? 'retry_wait' as const : 'review' as const })),
  };
  return { value, applyPage };
}

describe('durable Mailchimp reconciliation worker', () => {
  it('requests and immediately drains an owner-triggered baseline', async () => {
    const repo = repository();
    repo.value.request = vi.fn(async () => ({ run: baseRun, noOp: false }));
    const result = await requestAndDrainMailchimpReconciliationCommand(
      { getSelectedAudience: vi.fn(async () => ({
        id: 'binding-a', connectionId: 'connection-a', accountIdHash: 'a'.repeat(64),
        dataCenter: 'us21', audienceId: 'audience-a', audienceName: 'Audience A',
        mappingVersion: 1, selectedAt: '2026-08-11T11:00:00.000Z',
        baselineRequired: true, webhookRegistrationRequired: false,
      })) } as never,
      repo.value,
      configuration,
      {
        mode: 'live', workspaceId: 'workspace-a', role: 'owner',
        authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: 'membership-a',
      },
      { connectionId: 'connection-a', pageSize: 100, correlationId: 'correlation-a' },
      {
        workerId: 'worker-a', runtimeBudgetMs: 10_000,
        now: () => new Date('2026-08-11T12:00:00Z'), resolver,
        createClient: () => ({ listAudienceMembers: vi.fn(async () => ({
          totalItems: 1,
          members: [{
            memberId: 'member-a', subscriberHash: '4b9bb80620f03eb3719e0a061c14283d',
            normalizedEmail: 'buyer@example.com', subscriptionStatus: 'subscribed' as const,
            lastChangedAt: '2026-08-11T11:00:00.000Z',
          }],
        })) }),
      },
    );

    expect(repo.value.request).toHaveBeenCalledOnce();
    expect(result.drained).toEqual({ claimed: 1, completed: 1, deferred: 0, review: 0, pages: 1 });
  });

  it('decrypts a lease-bound token, applies a bounded page and completes it', async () => {
    const repo = repository();
    const result = await drainMailchimpReconciliationRuns({
      repository: repo.value,
      configuration,
      workerId: 'worker-a',
      deadlineMs: Date.parse('2026-08-11T12:01:00Z'),
      now: () => new Date('2026-08-11T12:00:00Z'),
      resolver,
      createClient: vi.fn((dataCenter, token) => {
        expect(dataCenter).toBe('us21');
        expect(token).toBe('token-a');
        return { listAudienceMembers: vi.fn(async () => ({
          totalItems: 1,
          members: [{
            memberId: 'member-a', subscriberHash: '4b9bb80620f03eb3719e0a061c14283d',
            normalizedEmail: 'buyer@example.com', subscriptionStatus: 'unsubscribed' as const,
            lastChangedAt: '2026-08-11T11:00:00.000Z',
          }],
        })) };
      }),
    });
    expect(result).toEqual({ claimed: 1, completed: 1, deferred: 0, review: 0, pages: 1 });
    expect(repo.applyPage).toHaveBeenCalledWith(expect.objectContaining({
      nextOffset: 1,
      members: [expect.objectContaining({ sourceHash: expect.stringMatching(/^[0-9a-f]{64}$/) })],
    }));
    expect(JSON.stringify(result)).not.toMatch(/buyer@example|token-a/);
  });

  it('checkpoints instead of starting another provider page after the runtime deadline', async () => {
    const repo = repository();
    repo.value.applyPage = vi.fn(async ({ run }) => ({
      run: { ...run, nextOffset: 1, providerTotal: 2, pagesApplied: 1, itemsSeen: 1, itemsApplied: 1 },
      finalPage: false, noOp: false,
    }));
    let calls = 0;
    const result = await drainMailchimpReconciliationRuns({
      repository: repo.value, configuration, workerId: 'worker-a',
      deadlineMs: Date.parse('2026-08-11T12:00:05Z'),
      now: () => new Date(calls++ < 7 ? '2026-08-11T12:00:00Z' : '2026-08-11T12:00:06Z'),
      resolver,
      createClient: () => ({ listAudienceMembers: vi.fn(async () => ({ totalItems: 2, members: [] })) }),
    });
    expect(result.deferred).toBe(1);
    expect(repo.value.transition).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'retry', errorCategory: 'runtime_checkpoint',
    }));
  });

  it('continues from the persisted offset and finishes a later page without replaying the first', async () => {
    const repo = repository();
    const resumed = { ...baseRun, state: 'leased' as const, nextOffset: 100, pagesApplied: 1,
      itemsSeen: 100, itemsApplied: 100, providerTotal: 101 };
    repo.value.claim = vi.fn(async () => [resumed]);
    repo.value.start = vi.fn(async ({ run }) => ({ ...run, state: 'executing' as const, attemptCount: 1 }));
    repo.value.readAuthority = vi.fn(async ({ run }) => ({
      run, dataCenter: 'us21', audienceId: 'audience-a', mappingVersion: 1, secretVersion: 1,
      accessTokenEnvelope: encryptConnectorSecret('token-a', {
        workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
        secretType: 'mailchimp-access-token', recordVersion: 1,
      }, resolver),
    }));
    const listAudienceMembers = vi.fn(async () => ({ totalItems: 101, members: [{
      memberId: 'member-last', subscriberHash: '4b9bb80620f03eb3719e0a061c14283d',
      normalizedEmail: 'buyer@example.com', subscriptionStatus: 'subscribed' as const,
      lastChangedAt: '2026-08-11T11:00:00.000Z',
    }] }));
    await drainMailchimpReconciliationRuns({
      repository: repo.value, configuration, workerId: 'worker-a',
      deadlineMs: Date.parse('2026-08-11T12:01:00Z'), now: () => new Date('2026-08-11T12:00:00Z'),
      resolver, createClient: () => ({ listAudienceMembers }),
    });
    expect(listAudienceMembers).toHaveBeenCalledWith({ audienceId: 'audience-a', count: 1, offset: 100 });
  });

  it('records a rate-limit category and leaves the durable run retryable', async () => {
    const repo = repository();
    const { ConnectorError } = await import('@/lib/domain/connector');
    const result = await drainMailchimpReconciliationRuns({
      repository: repo.value, configuration, workerId: 'worker-a',
      deadlineMs: Date.parse('2026-08-11T12:01:00Z'), now: () => new Date('2026-08-11T12:00:00Z'),
      resolver, createClient: () => ({
        listAudienceMembers: vi.fn(async () => { throw new ConnectorError('provider-retryable', 'Provider 429.'); }),
      }),
    });
    expect(result.deferred).toBe(1);
    expect(repo.value.transition).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'retry', errorCategory: 'rate_limited',
    }));
  });
});
