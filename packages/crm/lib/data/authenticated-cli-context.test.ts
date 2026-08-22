import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { createAuthenticatedCliContext } from './authenticated-cli-context';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a',
  ownerUserId: 'user-a',
  membershipId: 'membership-a',
  workspaceId: 'workspace-a',
  role: 'owner',
  mode: 'live',
};

describe('createAuthenticatedCliContext', () => {
  it('uses only public credentials and an authenticated end-user token', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-a', email: 'user@example.test' } },
      error: null,
    });
    const client = { auth: { getUser } } as unknown as SupabaseClient;
    const clientFactory = vi.fn(() => client) as never;
    const scopeResolver = vi.fn().mockResolvedValue(scope);
    const context = await createAuthenticatedCliContext({
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
        OMNIX_SUPABASE_ACCESS_TOKEN: 'end-user-token',
      },
      clientFactory,
      scopeResolver,
    });

    expect(clientFactory).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'public-anon-key',
      expect.objectContaining({
        global: { headers: { Authorization: 'Bearer end-user-token' } },
      }),
    );
    expect(getUser).toHaveBeenCalledWith('end-user-token');
    expect(scopeResolver).toHaveBeenCalledWith(client, 'user-a');
    expect(context).toEqual({ client, scope, userEmail: 'user@example.test' });
  });

  it('fails closed without all three required live values', async () => {
    await expect(createAuthenticatedCliContext({
      environment: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' },
    })).rejects.toThrow(/live mode refused/i);
  });

  it('refuses service-role keys before constructing a client', async () => {
    const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const clientFactory = vi.fn();
    await expect(createAuthenticatedCliContext({
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: `header.${payload}.signature`,
        OMNIX_SUPABASE_ACCESS_TOKEN: 'end-user-token',
      },
      clientFactory: clientFactory as never,
    })).rejects.toMatchObject({ code: 'forbidden' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('does not resolve a workspace when authentication fails', async () => {
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'expired' } }),
      },
    } as unknown as SupabaseClient;
    const scopeResolver = vi.fn();
    await expect(createAuthenticatedCliContext({
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
        OMNIX_SUPABASE_ACCESS_TOKEN: 'expired-token',
      },
      clientFactory: (() => client) as never,
      scopeResolver,
    })).rejects.toThrow(/invalid or expired/i);
    await expect(createAuthenticatedCliContext({
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
        OMNIX_SUPABASE_ACCESS_TOKEN: 'expired-token',
      },
      clientFactory: (() => client) as never,
      scopeResolver,
    })).rejects.toMatchObject({ code: 'forbidden' });
    expect(scopeResolver).not.toHaveBeenCalled();
  });
});
