import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '../domain/workspace';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import { supabaseMailchimpOAuthRepository } from './supabase-mailchimp-oauth-repository';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};
const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 4) };
const oauthEnvelope = encryptConnectorSecret('verifier', {
  workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
  secretType: 'oauth-pkce', recordVersion: 1,
}, resolver);

describe('Supabase Mailchimp OAuth repository', () => {
  it('uses authenticated authority to atomically start OAuth without plaintext', async () => {
    const authenticatedRpc = vi.fn(async () => ({ data: {
      oauthTransaction: { transactionId: 'transaction-a' },
    }, error: null }));
    const repository = supabaseMailchimpOAuthRepository({
      authenticated: { rpc: authenticatedRpc } as never,
      service: { rpc: vi.fn() } as never,
    });
    await expect(repository.begin(scope, {
      connectionId: 'connection-a', correlationId: 'correlation-a', displayLabel: 'Mailchimp account',
      sessionBindingHash: 'b'.repeat(64), safeReturnPath: '/connections',
      transaction: {
        id: 'transaction-a', workspaceId: 'workspace-a', provider: 'mailchimp',
        actorMembershipId: 'membership-a', stateHash: 'a'.repeat(64), pkceVerifier: 'never-persist-plain',
        redirectUri: 'https://crm.example.com/api/connectors/mailchimp/callback',
        requestedScopes: ['audience.reconcile', 'audience.sync'],
        createdAt: '2026-08-11T12:00:00Z', expiresAt: '2026-08-11T12:10:00Z',
      },
      verifierEnvelope: oauthEnvelope,
    })).resolves.toEqual({ connectionId: 'connection-a', transactionId: 'transaction-a' });
    expect(authenticatedRpc).toHaveBeenCalledWith('begin_mailchimp_oauth_v2', expect.objectContaining({
      target_workspace_id: 'workspace-a', target_pkce_ciphertext: expect.stringMatching(/^\\x/),
      target_requested_scopes: ['audience.sync', 'audience.reconcile'],
    }));
    expect(JSON.stringify(authenticatedRpc.mock.calls)).not.toContain('never-persist-plain');
  });

  it('uses service authority to finalize an active account binding and encrypted token', async () => {
    const serviceRpc = vi.fn(async (name: string) => name === 'finalize_mailchimp_oauth_v2'
      ? { data: { connection: { workspace_id: 'workspace-a', provider: 'mailchimp', status: 'active' } }, error: null }
      : { data: {}, error: null });
    const repository = supabaseMailchimpOAuthRepository({
      authenticated: { rpc: vi.fn() } as never, service: { rpc: serviceRpc } as never,
    });
    const tokenEnvelope = encryptConnectorSecret('token-value', {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'mailchimp-access-token', recordVersion: 1,
    }, resolver);
    await expect(repository.complete(scope, {
      transactionId: 'transaction-a', connectionId: 'connection-a', correlationId: 'correlation-a',
      identity: { accountId: 'account-a', accountName: 'Realtor', dataCenter: 'us21', apiBaseUrl: 'https://us21.api.mailchimp.com/3.0' },
      grantedScopes: ['audience.sync', 'audience.reconcile'], accessTokenEnvelope: tokenEnvelope,
      completedAt: '2026-08-11T12:01:00Z',
    })).resolves.toEqual({ connectionId: 'connection-a', status: 'active' });
    expect(serviceRpc).toHaveBeenCalledWith('finalize_mailchimp_oauth_v2', expect.objectContaining({
      target_transaction_id: 'transaction-a',
      target_provider_account_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      target_remote_identity_summary: expect.not.objectContaining({ accountId: 'account-a' }),
    }));
    expect(JSON.stringify(serviceRpc.mock.calls)).not.toContain('token-value');
  });

  it('rejects a consumed OAuth transaction from a different scope bundle', async () => {
    const repository = supabaseMailchimpOAuthRepository({
      authenticated: { rpc: vi.fn() } as never,
      service: { rpc: vi.fn(async () => ({ data: {
        transactionId: 'transaction-a', workspaceId: 'workspace-a', connectionId: 'connection-a',
        provider: 'mailchimp', requestedScopeBundle: 'different.bundle', requestedScopes: [],
        safeReturnPath: '/connections', consumedAt: '2026-08-11T12:01:00Z',
      }, error: null })) } as never,
    });
    await expect(repository.consume(scope, {
      stateHash: 'a'.repeat(64), sessionBindingHash: 'b'.repeat(64),
      redirectUri: 'https://crm.example.com/api/connectors/mailchimp/callback',
      consumedAt: '2026-08-11T12:01:00Z',
    })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
