import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { supabaseContactIdentityMap } from './supabase-contact-identity-map.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a', membershipId: 'member-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};

describe('supabaseContactIdentityMap', () => {
  it('reports whether bounded contact pages need canonical alias fallback', async () => {
    const client = {
      from: () => {
        const query = {
          select() { return query; }, eq() { return query; }, is() { return query; },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(resolve({ data: null, count: 2, error: null }));
          },
        };
        return query;
      },
    } as unknown as SupabaseClient;
    await expect(supabaseContactIdentityMap(client).hasActiveAliases?.(scope)).resolves.toBe(true);
  });

  it('resolves a canonical group and one bounded page map', async () => {
    const calls: string[] = [];
    const client = {
      async rpc(name: string) {
        calls.push(name);
        if (name === 'resolve_canonical_contact_id') return { data: 'survivor-a', error: null };
        return { data: [
          { contact_id: 'survivor-a', is_canonical: true, alias_epoch: 7 },
          { contact_id: 'donor-a', is_canonical: false, alias_epoch: 7 },
        ], error: null };
      },
      from() {
        const query = {
          select() { return query; }, eq() { return query; }, is() { return query; },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(resolve({ data: [
              { donor_contact_id: 'donor-a', survivor_contact_id: 'survivor-a' },
            ], error: null }));
          },
        };
        return query;
      },
    } as unknown as SupabaseClient;
    const identity = supabaseContactIdentityMap(client);

    await expect(identity.resolveCanonical(scope, 'donor-a')).resolves.toBe('survivor-a');
    await expect(identity.listGroupMembers(scope, 'donor-a')).resolves.toEqual({
      requestedContactId: 'donor-a', canonicalContactId: 'survivor-a',
      memberContactIds: ['survivor-a', 'donor-a'], aliasEpoch: 7,
    });
    const page = await identity.resolvePage(scope, ['donor-a', 'standalone-a']);
    expect([...page]).toEqual([['donor-a', 'survivor-a'], ['standalone-a', 'standalone-a']]);
    expect(calls).toEqual(['resolve_canonical_contact_id', 'list_contact_alias_group_ids']);
  });

  it('fails closed on malformed resolver receipts', async () => {
    const client = { rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient;
    await expect(supabaseContactIdentityMap(client).listGroupMembers(scope, 'contact-a'))
      .rejects.toThrow(/invalid group/i);
  });

  it('treats the exact not-yet-promoted merge read model as no aliases', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missing = {
      code: 'PGRST202',
      message: "Could not find the function public.resolve_canonical_contact_id in the schema cache",
    };
    const client = {
      rpc: async () => ({ data: null, error: missing }),
      from: () => ({
        select: () => ({
          eq: () => ({
            is: async () => ({
              data: null,
              error: {
                code: 'PGRST205',
                message: "Could not find the table 'public.contact_merge_aliases' in the schema cache",
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const identity = supabaseContactIdentityMap(client);

    await expect(identity.resolveCanonical(scope, 'contact-a')).resolves.toBe('contact-a');
    await expect(identity.listGroupMembers(scope, 'contact-a')).resolves.toEqual({
      requestedContactId: 'contact-a', canonicalContactId: 'contact-a',
      memberContactIds: ['contact-a'], aliasEpoch: 0,
    });
    await expect(identity.resolvePage(scope, ['contact-a'])).resolves.toEqual(new Map([
      ['contact-a', 'contact-a'],
    ]));
    expect(warning).toHaveBeenCalledWith(
      expect.stringMatching(/not installed/i),
      expect.objectContaining({ code: expect.stringMatching(/^PGRST/) }),
    );
    warning.mockRestore();
  });

  it('does not hide unrelated resolver failures', async () => {
    const client = {
      rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }),
    } as unknown as SupabaseClient;

    await expect(supabaseContactIdentityMap(client).resolveCanonical(scope, 'contact-a'))
      .rejects.toThrow(/permission denied/i);
  });
});
