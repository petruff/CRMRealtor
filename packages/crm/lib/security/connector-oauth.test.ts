import { describe, expect, it } from 'vitest';
import {
  connectorOAuthSessionBindingHash,
  createConnectorOAuthTransaction,
  verifyConnectorOAuthCallback,
} from './connector-oauth';

describe('connector OAuth transactions', () => {
  it('creates a PKCE-bound transaction and consumes matching state once', () => {
    const started = createConnectorOAuthTransaction({
      id: 'oauth-1',
      workspaceId: 'workspace-a',
      provider: 'google',
      actorMembershipId: 'membership-a',
      redirectUri: 'https://omnix.example.com/api/connectors/google/callback',
      requestedScopes: ['openid', 'email', 'openid'],
      now: new Date('2026-08-11T12:00:00Z'),
    });
    expect(started.state).not.toBe(started.transaction.stateHash);
    expect(started).toMatchObject({ codeChallengeMethod: 'S256' });
    expect(started.transaction.requestedScopes).toEqual(['email', 'openid']);
    const consumed = verifyConnectorOAuthCallback(
      started.transaction,
      started.state,
      new Date('2026-08-11T12:05:00Z'),
    );
    expect(consumed.consumedAt).toBe('2026-08-11T12:05:00.000Z');
    expect(() => verifyConnectorOAuthCallback(consumed, started.state, new Date('2026-08-11T12:05:01Z')))
      .toThrow(/already consumed/i);
  });

  it('rejects state mismatch, expiry, and unsafe redirect URIs', () => {
    const started = createConnectorOAuthTransaction({
      id: 'oauth-1', workspaceId: 'workspace-a', provider: 'mailchimp', actorMembershipId: 'membership-a',
      redirectUri: 'http://127.0.0.1:3200/api/connectors/mailchimp/callback',
      requestedScopes: ['audience:read'], now: new Date('2026-08-11T12:00:00Z'),
    });
    expect(() => verifyConnectorOAuthCallback(started.transaction, 'wrong', new Date('2026-08-11T12:01:00Z')))
      .toThrow(/state verification/i);
    expect(() => verifyConnectorOAuthCallback(started.transaction, started.state, new Date('2026-08-11T12:11:00Z')))
      .toThrow(/expired/i);
    expect(() => createConnectorOAuthTransaction({
      id: 'oauth-2', workspaceId: 'workspace-a', provider: 'meta', actorMembershipId: 'membership-a',
      redirectUri: 'http://example.com/callback', requestedScopes: ['messages'], now: new Date(),
    })).toThrow(/HTTPS or loopback/i);
  });

  it('binds the transaction to a redacted, deterministic session digest', () => {
    const input = {
      workspaceId: 'workspace-a', actorUserId: 'user-a', membershipId: 'membership-a', sessionId: 'session-a',
    };
    expect(connectorOAuthSessionBindingHash(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(connectorOAuthSessionBindingHash(input)).not.toBe(connectorOAuthSessionBindingHash({
      ...input, sessionId: 'session-b',
    }));
    expect(() => connectorOAuthSessionBindingHash({ ...input, sessionId: 'bad\nvalue' }))
      .toThrow(/session binding/i);
  });
});
