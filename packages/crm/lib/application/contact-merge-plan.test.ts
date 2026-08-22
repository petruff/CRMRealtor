import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { planExactContactMerge } from './contact-merge-plan.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: 'member-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};

describe('planExactContactMerge', () => {
  it('sends only hashed evidence and returns a redacted plan receipt', async () => {
    let parameters: unknown;
    const client = { rpc: async (_name: string, value: unknown) => {
      parameters = value;
      return { data: {
        planId: 'plan-a', state: 'pending', survivorContactId: 'contact-a',
        snapshotHash: 'b'.repeat(64), memberCount: 2, reasonCodes: [], noOp: false,
      }, error: null };
    } } as unknown as SupabaseClient;
    await expect(planExactContactMerge({
      client, scope, evidenceKind: 'email', groupHash: 'a'.repeat(64),
      idempotencyKey: 'merge-plan:test-a', occurredAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-20T13:00:00.000Z',
    })).resolves.toMatchObject({ planId: 'plan-a', state: 'pending', memberCount: 2 });
    expect(parameters).toMatchObject({
      target_group_hash: 'a'.repeat(64), target_reason_codes: [],
      target_workspace_id: 'workspace-a', target_actor_membership_id: 'member-a',
    });
    expect(JSON.stringify(parameters)).not.toContain('@');
  });

  it('rejects non-owner authority before calling persistence', async () => {
    const client = { rpc: async () => { throw new Error('must not run'); } } as unknown as SupabaseClient;
    await expect(planExactContactMerge({
      client, scope: { ...scope, role: 'assistant' }, evidenceKind: 'phone',
      groupHash: 'a'.repeat(64), idempotencyKey: 'merge-plan:test-b',
      occurredAt: '2026-08-20T12:00:00.000Z', expiresAt: '2026-08-20T13:00:00.000Z',
    })).rejects.toThrow(/live workspace owner/i);
  });
});
