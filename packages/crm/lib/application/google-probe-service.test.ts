import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../domain/connector';
import type { WorkspaceScope } from '../domain/workspace';
import type { GoogleProbeRepository } from '../data/supabase-google-probe-repository';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '../security/connector-secret-envelope';
import { probeLiveGoogleConnection } from './google-probe-service';

const scope: WorkspaceScope = {
  authenticatedUserId: '11111111-1111-4111-8111-111111111111', ownerUserId: '11111111-1111-4111-8111-111111111111',
  membershipId: '22222222-2222-4222-8222-222222222222', workspaceId: '33333333-3333-4333-8333-333333333333',
  role: 'owner', mode: 'live',
};
const connectionId = '44444444-4444-4444-8444-444444444444';
const resolver = createEnvironmentKekResolver({
  OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1', OMNIX_CONNECTOR_KEK_v1: Buffer.alloc(32, 9).toString('base64'),
});
function encrypted(value: string, type: string, version: number) {
  return { ...encryptConnectorSecret(value, { workspaceId: scope.workspaceId, connectionId,
    provider: 'google', secretType: type, recordVersion: version }, resolver), secretVersion: version };
}

describe('Google provider probe', () => {
  it('rejects support authority before reading provider secrets', async () => {
    const repository = { read: vi.fn() } as unknown as GoogleProbeRepository;
    await expect(probeLiveGoogleConnection({
      repository,
      scope: {
        ...scope,
        authenticatedUserId: 'support-user',
        membershipId: 'support-membership',
        role: 'assistant',
        supportGrant: { active: true },
      },
      connectionId,
      correlationId: 'correlation-support',
    })).rejects.toThrow(/workspace owner/i);
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('calls OIDC and Gmail profile, verifies the bound identity, and persists only hashes', async () => {
    const record = vi.fn(async () => ({ noOp: false }));
    const repository = {
      read: vi.fn(async () => ({
        workspaceId: scope.workspaceId, connectionId, displayLabel: 'owner@example.com',
        accountKeyHash: sha256Hex('google-subject'), grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.metadata'],
        gmailProfileCheckAvailable: true, accessState: 'live',
        access: encrypted('access-token', 'google-access-token', 1),
      })), refresh: vi.fn(), record,
    } as unknown as GoogleProbeRepository;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'google-subject', email: 'owner@example.com', email_verified: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: 'owner@example.com', historyId: '100' }), { status: 200 }));
    const result = await probeLiveGoogleConnection({ repository, scope, connectionId,
      correlationId: '55555555-5555-4555-8555-555555555555', now: new Date('2026-08-12T12:00:00Z'), resolver, fetcher });
    expect(result).toMatchObject({ healthy: true, status: 'active', gmailProfileChecked: true });
    expect(record).toHaveBeenCalledWith(scope, expect.objectContaining({
      outcome: 'healthy', accountHash: sha256Hex('google-subject'), emailHash: sha256Hex('owner@example.com'),
      evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(JSON.stringify(record.mock.calls)).not.toContain('access-token');
  });

  it('refreshes an expired token with CAS before probing the provider', async () => {
    const refresh = vi.fn(async () => undefined);
    const repository = {
      read: vi.fn(async () => ({
        workspaceId: scope.workspaceId, connectionId, displayLabel: 'owner@example.com',
        accountKeyHash: sha256Hex('google-subject'), grantedScopes: ['openid', 'email'],
        gmailProfileCheckAvailable: false, accessState: 'refresh-required',
        access: encrypted('expired-token', 'google-access-token', 1),
        refresh: encrypted('refresh-token', 'google-refresh-token', 1),
      })), refresh, record: vi.fn(async () => ({ noOp: false })),
    } as unknown as GoogleProbeRepository;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh-token', expires_in: 3600, scope: 'openid email' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'google-subject', email: 'owner@example.com', email_verified: true }), { status: 200 }));
    const result = await probeLiveGoogleConnection({ repository, scope, connectionId,
      correlationId: '55555555-5555-4555-8555-555555555555', now: new Date('2026-08-12T12:00:00Z'), resolver, fetcher,
      oauthConfiguration: { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://crm.example.com/api/connectors/google/callback' } });
    expect(result.healthy).toBe(true);
    expect(refresh).toHaveBeenCalledWith(scope, expect.objectContaining({ expectedVersion: 1,
      accessEnvelope: expect.objectContaining({ expiresAt: '2026-08-12T13:00:00.000Z' }) }));
  });
});
