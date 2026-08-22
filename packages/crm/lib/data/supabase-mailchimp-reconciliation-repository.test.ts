import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseMailchimpReconciliationRepository } from './supabase-mailchimp-reconciliation-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};

const row = {
  id: 'run-a', workspace_id: 'workspace-a', connection_id: 'connection-a', binding_id: 'binding-a',
  mode: 'baseline', state: 'queued', snapshot_hash: 'a'.repeat(64), page_size: 100, next_offset: 0,
  provider_total: null, pages_applied: 0, items_seen: 0, items_applied: 0, items_reviewed: 0,
  items_blocked: 0, attempt_count: 0, max_attempts: 5, fencing_token: 0,
  correlation_id: 'correlation-a', lease_owner: null,
};

describe('Supabase Mailchimp reconciliation repository', () => {
  it('requests an exact owner-authorized snapshot', async () => {
    const rpc = vi.fn(async () => ({ data: { run: row, noOp: false }, error: null }));
    const repository = supabaseMailchimpReconciliationRepository({
      authenticated: { rpc } as never,
      service: { rpc: vi.fn() } as never,
    });
    await expect(repository.request(scope, {
      connectionId: 'connection-a', bindingId: 'binding-a', mode: 'baseline',
      snapshotHash: 'a'.repeat(64), requestKeyHash: 'b'.repeat(64), pageSize: 100,
      correlationId: 'correlation-a', requestedAt: '2026-08-11T12:00:00.000Z',
    })).resolves.toMatchObject({ run: { id: 'run-a', state: 'queued' }, noOp: false });
    expect(rpc).toHaveBeenCalledWith('request_mailchimp_reconciliation_run', expect.objectContaining({
      target_connection_id: 'connection-a', target_binding_id: 'binding-a', target_page_size: 100,
    }));
  });

  it('reads provider authority only through the leased service RPC', async () => {
    const rpc = vi.fn(async () => ({ data: {
      run: { runId: 'run-a', mode: 'baseline', snapshotHash: 'a'.repeat(64), pageSize: 100,
        nextOffset: 0, providerTotal: null, attemptCount: 1, fencingToken: 2,
        leaseExpiresAt: '2026-08-11T12:10:00Z' },
      binding: { workspaceId: 'workspace-a', connectionId: 'connection-a', bindingId: 'binding-a',
        dataCenter: 'us21', audienceId: 'audience-a', mappingVersion: 1 },
      secret: {
        secretVersion: 1, ciphertext: 'YQ==', nonce: 'YWFhYWFhYWFhYWFh', authTag: 'YWFhYWFhYWFhYWFhYWFhYQ==',
        wrappedDek: 'YQ==', wrapNonce: 'YWFhYWFhYWFhYWFh', wrapAuthTag: 'YWFhYWFhYWFhYWFhYWFhYQ==',
        kekVersion: 'v1', aadHash: 'c'.repeat(64),
      },
    }, error: null }));
    const repository = supabaseMailchimpReconciliationRepository({
      authenticated: { rpc: vi.fn() } as never,
      service: { rpc } as never,
    });
    const executing = {
      id: 'run-a', workspaceId: 'workspace-a', connectionId: 'connection-a', bindingId: 'binding-a',
      mode: 'baseline' as const, state: 'executing' as const, snapshotHash: 'a'.repeat(64), pageSize: 100,
      nextOffset: 0, pagesApplied: 0, itemsSeen: 0, itemsApplied: 0, itemsReviewed: 0, itemsBlocked: 0,
      attemptCount: 1, maxAttempts: 5, fencingToken: 2, leaseOwner: 'worker-a', correlationId: 'correlation-a',
    };
    await expect(repository.readAuthority({ run: executing, workerId: 'worker-a', now: '2026-08-11T12:00:00Z' }))
      .resolves.toMatchObject({ audienceId: 'audience-a', dataCenter: 'us21', secretVersion: 1 });
    expect(rpc).toHaveBeenCalledWith('read_mailchimp_reconciliation_access_token', expect.objectContaining({
      target_run_id: 'run-a', target_worker_id: 'worker-a', target_fencing_token: 2,
    }));
  });

  it('classifies an expired or stolen worker lease without retrying under stale authority', async () => {
    const repository = supabaseMailchimpReconciliationRepository({
      authenticated: { rpc: vi.fn() } as never,
      service: { rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })) } as never,
    });
    await expect(repository.claim({
      workerId: 'worker-a', batchSize: 10, leaseSeconds: 90, now: '2026-08-11T12:00:00Z',
    })).rejects.toMatchObject({ code: 'lease-lost' });
  });
});
