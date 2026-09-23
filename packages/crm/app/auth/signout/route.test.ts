import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { signOut } }) }));

import { POST } from './route';

function request(scope?: string) {
  const body = new FormData();
  if (scope) body.set('scope', scope);
  return new Request('https://crm.example.com/auth/signout', { method: 'POST', body });
}

describe('sign-out route', () => {
  beforeEach(() => signOut.mockClear());

  it('signs out only this browser by default', async () => {
    const response = await POST(request());
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://crm.example.com/login');
  });

  it('revokes every session when asked to sign out everywhere', async () => {
    const response = await POST(request('global'));
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(response.headers.get('location')).toBe('https://crm.example.com/login?signedOut=all');
  });

  it('never escalates an unknown scope', async () => {
    await POST(request('others'));
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
