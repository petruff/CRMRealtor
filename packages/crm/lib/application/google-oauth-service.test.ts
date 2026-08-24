import { describe, expect, it, vi } from 'vitest';
import type { GoogleOAuthRepository } from '../data/google-oauth-repository';
import { createEnvironmentKekResolver } from '../security/connector-secret-envelope';
import { beginGoogleOAuth, completeGoogleOAuth } from './google-oauth-service';

const scope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner' as const, mode: 'live' as const,
};
const configuration = {
  clientId: 'client-a', clientSecret: 'secret-a',
  redirectUri: 'https://crm.example.com/api/connectors/google/callback',
};
const resolver = createEnvironmentKekResolver({
  OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'test-kek',
  'OMNIX_CONNECTOR_KEK_test-kek': Buffer.alloc(32, 7).toString('base64'),
});

describe('Google incremental OAuth service', () => {
  it('offers one guided workspace bundle while preserving exact scopes', async () => {
    const begin = vi.fn(async (_scope, input) => ({ connectionId: input.connectionId, transactionId: 'tx-guided' }));
    const result = await beginGoogleOAuth({
      repository: { begin } as unknown as GoogleOAuthRepository,
      scope, actorUserId: 'user-a', sessionSecret: 'session-secret', safeReturnPath: '/connections',
      bundle: 'workspace-core', configuration, resolver, now: new Date('2026-08-12T12:00:00Z'),
    });
    const scopes = new URL(result.authorizationUrl).searchParams.get('scope')?.split(' ') ?? [];
    expect(scopes).toEqual(expect.arrayContaining([
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://www.googleapis.com/auth/calendar.app.created',
    ]));
    expect(begin).toHaveBeenCalledWith(scope, expect.objectContaining({ bundle: 'workspace-core' }));
  });

  it('starts a single feature bundle with session/workspace-bound PKCE', async () => {
    const begin = vi.fn(async (_scope, input) => ({ connectionId: input.connectionId, transactionId: 'tx-a' }));
    const result = await beginGoogleOAuth({
      repository: { begin } as unknown as GoogleOAuthRepository,
      scope, actorUserId: 'user-a', sessionSecret: 'session-secret', safeReturnPath: '/connections',
      bundle: 'gmail-send', configuration, resolver, now: new Date('2026-08-12T12:00:00Z'),
    });
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get('scope')).toContain('gmail.send');
    expect(url.searchParams.get('scope')).not.toContain('gmail.metadata');
    expect(begin).toHaveBeenCalledWith(scope, expect.objectContaining({ bundle: 'gmail-send' }));
  });

  it('consumes once, verifies PKCE, and persists encrypted tokens for the same account', async () => {
    let started: Parameters<GoogleOAuthRepository['begin']>[1] | undefined;
    const repository: GoogleOAuthRepository = {
      begin: async (_scope, input) => { started = input; return { connectionId: input.connectionId, transactionId: 'tx-a' }; },
      consume: async () => ({
        transactionId: 'tx-a', workspaceId: scope.workspaceId,
        connectionId: started!.connectionId, provider: 'google',
        requestedScopeBundle: 'google.gmail-metadata.v1',
        requestedScopes: started!.transaction.requestedScopes,
        safeReturnPath: '/connections', verifierEnvelope: started!.verifierEnvelope,
        expectedAccessSecretVersion: 2, expectedRefreshSecretVersion: 4,
        consumedAt: '2026-08-12T12:00:01.000Z',
      }),
      complete: vi.fn(async (_scope, input) => ({
        connectionId: input.connectionId, status: 'active' as const,
        grantedScopes: input.grantedScopes,
      })),
    };
    const oauth = await beginGoogleOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret',
      safeReturnPath: '/connections', bundle: 'gmail-metadata', configuration, resolver,
      now: new Date('2026-08-12T12:00:00Z'),
    });
    const state = new URL(oauth.authorizationUrl).searchParams.get('state')!;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600,
        scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.metadata',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: 'subject-a', email: 'owner@example.com', email_verified: true,
      }), { status: 200 }));
    await expect(completeGoogleOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret',
      state, code: 'provider-code', configuration, resolver, fetcher,
      now: new Date('2026-08-12T12:00:01Z'),
    })).resolves.toMatchObject({
      accountEmail: 'owner@example.com', bundle: 'gmail-metadata', missingScopes: [],
    });
    expect(repository.complete).toHaveBeenCalledWith(scope, expect.objectContaining({
      bundle: 'gmail-metadata', accessTokenEnvelope: expect.objectContaining({ ciphertext: expect.any(String) }),
      refreshTokenEnvelope: expect.objectContaining({ ciphertext: expect.any(String) }),
      expectedAccessSecretVersion: 2, expectedRefreshSecretVersion: 4,
      grantedScopes: ['email', 'https://www.googleapis.com/auth/gmail.metadata', 'openid'],
    }));
  });
});
