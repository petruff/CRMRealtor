import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { supabaseMailchimpOutboundBackfillRepository } from './supabase-mailchimp-outbound-backfill-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};

describe('Supabase Mailchimp outbound backfill repository', () => {
  it('uses the owner RPC for a count-only canonical preview', async () => {
    const rpc = vi.fn(async () => ({ data: { preview: {
      runId: 'run-a', workspaceId: 'workspace-a', connectionId: 'connection-a', bindingId: 'binding-a',
      mode: 'backfill', mappingVersion: 1, snapshotHash: 'a'.repeat(64), eligibleCount: 2,
      skippedUnlinkedCount: 1, skippedUnsubscribedCount: 1, pageSize: 100, containsRawEmails: false,
    }, noOp: false }, error: null }));
    const repository = supabaseMailchimpOutboundBackfillRepository({
      authenticated: { rpc } as never, service: {} as never,
    });
    const preview = await repository.preview(scope, {
      connectionId: 'connection-a', mode: 'backfill', requestKeyHash: 'b'.repeat(64), pageSize: 100,
      correlationId: 'correlation-a', previewedAt: '2026-08-12T12:00:00.000Z', maxAttempts: 10,
    });
    expect(preview).toMatchObject({ eligibleCount: 2, containsRawEmails: false });
    expect(rpc).toHaveBeenCalledWith('preview_mailchimp_outbound_backfill', expect.objectContaining({
      target_connection_id: 'connection-a', target_page_size: 100,
    }));
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/@|email/i);
  });

  it('maps stale worker authority to lease-lost', async () => {
    const repository = supabaseMailchimpOutboundBackfillRepository({
      authenticated: {} as never,
      service: { rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })) } as never,
    });
    await expect(repository.readPage({
      runId: 'run-a', workerId: 'worker-a', fencingToken: 1, now: '2026-08-12T12:00:00.000Z',
    })).rejects.toMatchObject({ code: 'lease-lost' });
  });
});
