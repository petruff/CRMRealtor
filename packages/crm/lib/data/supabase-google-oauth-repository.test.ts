import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseGoogleOAuthRepository } from './supabase-google-oauth-repository';

const scope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner' as const, mode: 'live' as const,
};
const secret = {
  schemaVersion: 'connector-secret-envelope.v1' as const, algorithm: 'AES-256-GCM' as const,
  ciphertext: 'YQ==', iv: 'YQ==', tag: 'YQ==', encryptedDek: 'YQ==',
  encryptedDekIv: 'YQ==', encryptedDekTag: 'YQ==', kekVersion: 'k1', aadHash: 'a'.repeat(64),
};

describe('Supabase Google OAuth repository', () => {
  it('maps single-use consume versions and finalizes separate encrypted tokens', async () => {
    const calls: { name: string; values: Record<string, unknown> }[] = [];
    const rpc = async (name: string, values: Record<string, unknown>) => {
      calls.push({ name, values });
      if (name === 'consume_google_oauth_transaction') return { data: {
        transactionId: 'tx-a', workspaceId: scope.workspaceId, connectionId: 'connection-a',
        provider: 'google', bundle: 'gmail-send', requestedScopes: ['openid', 'email'],
        safeReturnPath: '/connections', pkceCiphertext: 'YQ==', pkceNonce: 'YQ==',
        pkceAuthTag: 'YQ==', pkceWrappedDek: 'YQ==', pkceWrapNonce: 'YQ==',
        pkceWrapAuthTag: 'YQ==', kekVersion: 'k1', aadHash: 'a'.repeat(64),
        expectedAccessSecretVersion: 2, expectedRefreshSecretVersion: 3,
        consumedAt: '2026-08-12T12:00:00Z',
      }, error: null };
      return { data: { connection: {
        id: 'connection-a', workspace_id: scope.workspaceId, provider: 'google',
        status: 'active', granted_scopes: ['openid', 'email'],
      } }, error: null };
    };
    const repository = supabaseGoogleOAuthRepository({
      authenticated: { rpc } as unknown as SupabaseClient,
      service: { rpc } as unknown as SupabaseClient,
    });
    const consumed = await repository.consume(scope, {
      stateHash: 'a'.repeat(64), sessionBindingHash: 'b'.repeat(64),
      redirectUri: 'https://crm.example.com/api/connectors/google/callback',
      consumedAt: '2026-08-12T12:00:00Z',
    });
    expect(consumed).toMatchObject({
      requestedScopeBundle: 'google.gmail-send.v1',
      expectedAccessSecretVersion: 2, expectedRefreshSecretVersion: 3,
    });
    await repository.complete(scope, {
      transactionId: 'tx-a', connectionId: 'connection-a', correlationId: 'correlation-a',
      bundle: 'gmail-send', identity: { subject: 'subject-a', email: 'owner@example.com', displayLabel: 'owner@example.com' },
      grantedScopes: ['openid', 'email'], accessTokenEnvelope: secret,
      refreshTokenEnvelope: secret, expectedAccessSecretVersion: 2, expectedRefreshSecretVersion: 3,
      tokenExpiresAt: '2026-08-12T13:00:00Z', completedAt: '2026-08-12T12:00:00Z',
    });
    expect(calls.at(-1)).toMatchObject({
      name: 'finalize_google_oauth', values: {
        target_transaction_id: 'tx-a', target_expected_access_secret_version: 2,
        target_expected_refresh_secret_version: 3,
        target_access_envelope: expect.objectContaining({ expiresAt: '2026-08-12T13:00:00Z' }),
      },
    });
    expect(JSON.stringify(calls)).not.toContain('access-token');
  });
});
