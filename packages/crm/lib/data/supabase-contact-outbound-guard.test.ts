import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { supabaseContactOutboundGuard } from './supabase-contact-outbound-guard.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: 'member-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};

describe('supabaseContactOutboundGuard', () => {
  it('returns the reviewed alias epoch from the database assertion', async () => {
    const client = { rpc: async () => ({ data: {
      contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 4,
    }, error: null }) } as unknown as SupabaseClient;
    await expect(supabaseContactOutboundGuard(client).assertTarget(scope, 'contact-a', 'point-a'))
      .resolves.toEqual({ contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 4 });
  });

  it('turns a database refusal into manual review and never substitutes a recipient', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'aliased donor' } }) } as unknown as SupabaseClient;
    await expect(supabaseContactOutboundGuard(client).assertTarget(scope, 'donor-a', 'point-a'))
      .rejects.toThrow(/manual review.*aliased donor/i);
  });

  it('refuses dispatch when the alias epoch changed after owner review', async () => {
    const client = { rpc: async () => ({ data: {
      contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 5,
    }, error: null }) } as unknown as SupabaseClient;
    await expect(supabaseContactOutboundGuard(client).assertTarget(scope, 'contact-a', 'point-a', 4))
      .rejects.toThrow(/alias state changed/i);
  });

  it('supports contact-only review for Meta and physical mail without inventing a contact point', async () => {
    const client = { rpc: async () => ({ data: {
      contactId: 'contact-a', contactPointId: null, aliasEpoch: 4,
    }, error: null }) } as unknown as SupabaseClient;
    await expect(supabaseContactOutboundGuard(client).assertTarget(scope, 'contact-a'))
      .resolves.toEqual({ contactId: 'contact-a', aliasEpoch: 4 });
  });
});
