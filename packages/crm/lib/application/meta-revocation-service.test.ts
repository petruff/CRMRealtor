import { describe, expect, it, vi } from 'vitest';
import { revokeMetaProviderConnection } from './meta-revocation-service';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import type { ConnectorRevocationJob } from '../data/supabase-connector-revocation-repository';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const connectionId = '00000000-0000-4000-8000-000000000002';
const resolver = { activeVersion: 'kek-test', resolve: () => Buffer.alloc(32, 7) };
const job = { id: 'job-a', workspaceId, connectionId, provider: 'meta', state: 'executing',
  attemptCount: 1, maxAttempts: 5, scheduledAt: '2026-08-12T12:00:00Z', leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-12T12:02:00Z', fencingToken: 1, correlationId: 'correlation-a',
  connection: { id: connectionId, workspaceId, provider: 'meta', remoteAccountId: 'account-hash',
    grantedScopes: [], status: 'revoking', connectedAt: '2026-08-12T12:00:00Z', updatedAt: '2026-08-12T12:00:00Z' },
} satisfies ConnectorRevocationJob;
function persisted(secret: string, type: string, version: number) {
  const value = encryptConnectorSecret(secret, { workspaceId, connectionId, provider: 'meta', secretType: type, recordVersion: version }, resolver);
  return { secretType: type, secretVersion: version, payloadKind: type, envelopeVersion: version,
    ciphertext: value.ciphertext, nonce: value.iv, authTag: value.tag, wrappedDek: value.encryptedDek,
    wrapNonce: value.encryptedDekIv, wrapAuthTag: value.encryptedDekTag, kekVersion: value.kekVersion, aadHash: value.aadHash };
}
const environment = { META_APP_ID: 'app', META_APP_SECRET: 'secret', META_REDIRECT_URI: 'https://crm.example.com/api/connectors/meta/callback',
  META_GRAPH_API_VERSION: 'v99.0', META_GRAPH_API_VERSION_SOURCE_URL: 'https://developers.facebook.com/docs/graph-api/changelog/versions',
  META_GRAPH_API_VERSION_VERIFIED_AT: '2026-08-12T00:00:00Z' };

describe('Meta provider revocation', () => {
  it('unsubscribes selected assets before revoking the account grant', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('{"success":true}', { status: 200 });
    });
    const pagePayload = JSON.stringify({ accessToken: 'page-token', assetId: 'page-1', assetIdHash: 'a'.repeat(64),
      connectionId, graphVersion: 'v99.0', tokenVersion: 1, workspaceId });
    await expect(revokeMetaProviderConnection({ job, resolver, environment, fetcher, authority: {
      graphVersion: 'v99.0', loginMode: 'facebook-page', connectionAccessToken: persisted('user-token', 'meta-access-token', 1),
      selectedAssets: [{ channel: 'facebook', assetId: 'page-1', pageAccessToken: persisted(pagePayload, 'meta-page-access-token', 1) }],
    } })).resolves.toMatchObject({ outcome: 'succeeded', providerStatus: 'provider-confirmed' });
    expect(calls).toEqual([
      'https://graph.facebook.com/v99.0/page-1/subscribed_apps',
      'https://graph.facebook.com/v99.0/me/permissions',
    ]);
  });
});
