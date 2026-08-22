import { describe, expect, it, vi } from 'vitest';
import type { MailchimpOAuthRepository } from '../data/mailchimp-oauth-repository';
import type { WorkspaceScope } from '../domain/workspace';
import { beginMailchimpOAuth, completeMailchimpOAuth } from './mailchimp-oauth-service';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};
const configuration = {
  clientId: 'client-a', clientSecret: 'secret-a',
  redirectUri: 'https://crm.example.com/api/connectors/mailchimp/callback',
};
const resolver = {
  activeVersion: 'v1',
  resolve: () => Buffer.alloc(32, 7),
};

describe('Mailchimp OAuth service', () => {
  it('persists a session/workspace-bound start before returning the provider URL', async () => {
    const begin = vi.fn().mockResolvedValue({ connectionId: 'ignored', transactionId: 'transaction-a' });
    const repository = { begin } as unknown as MailchimpOAuthRepository;
    const result = await beginMailchimpOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret',
      safeReturnPath: '/connections', configuration, resolver,
      now: new Date('2026-08-11T12:00:00Z'),
    });
    expect(new URL(result.authorizationUrl).origin).toBe('https://login.mailchimp.com');
    expect(begin).toHaveBeenCalledWith(scope, expect.objectContaining({
      sessionBindingHash: expect.stringMatching(/^[a-f0-9]{64}$/), safeReturnPath: '/connections',
    }));
    expect(JSON.stringify(begin.mock.calls)).not.toContain('session-secret');
  });

  it('reauthorizes the existing connection with the next encrypted secret version', async () => {
    let persisted: Parameters<MailchimpOAuthRepository['begin']>[1] | undefined;
    const complete = vi.fn(async (_scope, value) => ({ connectionId: value.connectionId, status: 'active' as const }));
    const repository: MailchimpOAuthRepository = {
      begin: async (_scope, value) => { persisted = value; return { connectionId: value.connectionId, transactionId: 'tx-b' }; },
      consume: async () => ({
        transactionId: 'tx-b', workspaceId: scope.workspaceId, connectionId: 'connection-existing',
        provider: 'mailchimp', requestedScopeBundle: 'mailchimp.audience-sync.v1',
        requestedScopes: ['audience.sync', 'audience.reconcile'], safeReturnPath: '/connections',
        verifierEnvelope: persisted!.verifierEnvelope, expectedAccessSecretVersion: 3,
        consumedAt: '2026-08-11T12:01:00.000Z',
      }),
      complete,
    };
    const started = await beginMailchimpOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret',
      safeReturnPath: '/connections', connectionId: 'connection-existing', configuration, resolver,
      now: new Date('2026-08-11T12:00:00Z'),
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'provider-token-v4' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountname: 'Realtor', login: 'owner', dc: 'us21' }), { status: 200 }));
    await completeMailchimpOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret', state,
      code: 'one-time-code', configuration, resolver, fetcher,
      now: new Date('2026-08-11T12:01:00Z'),
    });
    expect(started.connectionId).toBe('connection-existing');
    expect(complete).toHaveBeenCalledWith(scope, expect.objectContaining({
      transactionId: 'tx-b', connectionId: 'connection-existing', expectedAccessSecretVersion: 3,
      accessTokenEnvelope: expect.objectContaining({ schemaVersion: 'connector-secret-envelope.v1' }),
    }));
  });

  it('consumes once, exchanges at fixed endpoints, encrypts the token, and returns no secret', async () => {
    let persisted: Parameters<MailchimpOAuthRepository['begin']>[1] | undefined;
    const repository: MailchimpOAuthRepository = {
      async begin(_scope, value) { persisted = value; return { connectionId: value.connectionId, transactionId: 'tx-a' }; },
      consume: vi.fn(async (_scope, value) => ({
        transactionId: 'tx-a', workspaceId: 'workspace-a', connectionId: persisted!.connectionId,
        provider: 'mailchimp' as const, requestedScopeBundle: 'mailchimp.audience-sync.v1' as const,
        requestedScopes: ['audience.sync'], safeReturnPath: '/connections',
        verifierEnvelope: persisted!.verifierEnvelope, consumedAt: value.consumedAt,
      })),
      complete: vi.fn(async (_scope, value) => ({ connectionId: value.connectionId, status: 'active' as const })),
    };
    const started = await beginMailchimpOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret',
      safeReturnPath: '/connections', configuration, resolver,
      now: new Date('2026-08-11T12:00:00Z'),
    });
    const state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'provider-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountname: 'Realtor', login: 'owner', dc: 'us21' }), { status: 200 }));
    const result = await completeMailchimpOAuth({
      repository, scope, actorUserId: 'user-a', sessionSecret: 'session-secret', state,
      code: 'one-time-code', configuration, resolver, fetcher,
      now: new Date('2026-08-11T12:01:00Z'),
    });
    expect(result).toMatchObject({ accountName: 'Realtor', dataCenter: 'us21', safeReturnPath: '/connections' });
    expect(JSON.stringify(result)).not.toContain('provider-token');
    expect(repository.complete).toHaveBeenCalledWith(scope, expect.objectContaining({
      accessTokenEnvelope: expect.objectContaining({ schemaVersion: 'connector-secret-envelope.v1' }),
    }));
    expect(JSON.stringify(vi.mocked(repository.complete).mock.calls)).not.toContain('provider-token');
  });

  it('refuses assistants and mismatched actors before any provider traffic', async () => {
    const repository = { begin: vi.fn() } as unknown as MailchimpOAuthRepository;
    await expect(beginMailchimpOAuth({
      repository, scope: { ...scope, role: 'assistant' }, actorUserId: 'user-a', sessionSecret: 'session',
      safeReturnPath: '/connections', configuration, resolver,
    })).rejects.toThrow(/owner/i);
    await expect(beginMailchimpOAuth({
      repository, scope, actorUserId: 'user-b', sessionSecret: 'session',
      safeReturnPath: '/connections', configuration, resolver,
    })).rejects.toThrow(/actor/i);
  });
});
