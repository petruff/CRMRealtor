import { describe, expect, it, vi } from 'vitest';
import { selectAndSubscribeMetaAssets } from './meta-asset-setup-service';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import type { WorkspaceScope } from '../domain/workspace';

const scope: WorkspaceScope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'member-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live',
};
const connectionId = 'connection-a';
const assetId = 'instagram-business-a';
const assetIdHash = 'a'.repeat(64);
const key = Buffer.alloc(32, 9).toString('base64');
const environment = {
  OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1', OMNIX_CONNECTOR_KEK_v1: key,
  META_RETENTION_DAYS: '30', META_RETENTION_POLICY_HASH: 'b'.repeat(64),
  META_WEBHOOK_ENDPOINT_KEY: 'endpoint-key-1234567890', META_APP_SECRET: 'app-secret',
  META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
};
const configuration = {
  appId: 'app', appSecret: 'app-secret', redirectUri: 'https://crm.example.com/api/connectors/meta/callback',
  graphVersion: 'v99.0', versionSourceUrl: 'https://developers.facebook.com/docs/graph-api/changelog/versions',
  versionVerifiedAt: '2026-08-12T00:00:00Z',
  facebookAuthorizationEndpoint: 'https://www.facebook.com/v99.0/dialog/oauth',
  facebookTokenEndpoint: 'https://graph.facebook.com/v99.0/oauth/access_token',
  instagramAuthorizationEndpoint: 'https://www.instagram.com/oauth/authorize',
  instagramTokenEndpoint: 'https://api.instagram.com/oauth/access_token',
};

function encryptedConnectionToken() {
  const envelope = encryptConnectorSecret('instagram-access-token', {
    workspaceId: scope.workspaceId, connectionId, provider: 'meta', secretType: 'meta-access-token', recordVersion: 1,
  }, { activeVersion: 'v1', resolve: () => Buffer.from(key, 'base64') });
  return { secretVersion: 1, ciphertext: envelope.ciphertext, nonce: envelope.iv, authTag: envelope.tag,
    wrappedDek: envelope.encryptedDek, wrapNonce: envelope.encryptedDekIv, wrapAuthTag: envelope.encryptedDekTag,
    kekVersion: envelope.kekVersion, aadHash: envelope.aadHash };
}

describe('Meta selected-asset subscription recovery', () => {
  it('retries a failed Instagram subscription from frozen owner-bound authority without rediscovery', async () => {
    const authenticated = { rpc: vi.fn(async (name: string) => {
      expect(name).toBe('select_meta_assets');
      return { data: { noOp: true }, error: null };
    }) };
    const calls: string[] = [];
    const service = { rpc: vi.fn(async (name: string) => {
      calls.push(name);
      if (name === 'read_meta_asset_subscription_retry_authority') return { data: {
        workspaceId: scope.workspaceId, connectionId, graphVersion: 'v99.0', loginMode: 'instagram-login',
        selectedAssets: [{ bindingId: 'binding-a', channel: 'instagram', assetIdHash, assetId,
          subscriptionState: { status: 'failed', last_provider_evidence_hash: null },
          retryAllowed: true, pageAccessToken: null }],
        connectionAccessToken: encryptedConnectionToken(),
      }, error: null };
      if (name === 'read_meta_webhook_authority') return { data: null, error: { code: 'P0002' } };
      return { data: {}, error: null };
    }) };
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('/subscribed_apps');
      return new Response('{"success":true}', { status: 200 });
    });

    await expect(selectAndSubscribeMetaAssets({ authenticated: authenticated as never, service: service as never,
      scope, connectionId, snapshotHash: 'c'.repeat(64), assetHashes: [assetIdHash], configuration,
      environment, fetcher, now: new Date('2026-08-12T12:00:00Z') })).resolves.toMatchObject({
      connectionId, assetCount: 1, subscribedCount: 1, webhookBound: true,
    });
    expect(calls).toEqual([
      'read_meta_asset_subscription_retry_authority', 'record_meta_asset_subscription_result',
      'record_meta_asset_subscription_result', 'read_meta_webhook_authority', 'bind_meta_webhook_authority',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(`/v99.0/${assetId}/subscribed_apps`);
  });
});
