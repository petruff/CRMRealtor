import { describe, expect, it } from 'vitest';
import { createMetaAuthorizationUrl, discoverMetaBusinessAssets, loadMetaOAuthConfiguration,
  revokeMetaOAuthGrant, subscribeMetaBusinessAsset, unsubscribeMetaBusinessAsset } from './meta-client';

const base = {
  META_APP_ID: 'meta-app', META_APP_SECRET: 'meta-secret',
  META_REDIRECT_URI: 'https://crm.example.com/api/connectors/meta/callback',
  META_GRAPH_API_VERSION: 'v99.0',
  META_GRAPH_API_VERSION_SOURCE_URL: 'https://developers.facebook.com/docs/graph-api/changelog/versions',
  META_GRAPH_API_VERSION_VERIFIED_AT: '2026-08-12T00:00:00Z',
};

describe('Meta provider OAuth boundary', () => {
  it('allows Facebook Page OAuth without silently requiring Instagram product endpoints', () => {
    const configuration = loadMetaOAuthConfiguration(base);
    const url = new URL(createMetaAuthorizationUrl({ configuration, loginMode: 'facebook-page',
      state: 'a'.repeat(32), scopes: ['pages_show_list'] }));
    expect(url.hostname).toBe('www.facebook.com');
    expect(configuration.instagramAuthorizationEndpoint).toBeUndefined();
  });

  it('fails closed for Instagram until its current official product endpoints are configured', () => {
    const configuration = loadMetaOAuthConfiguration(base);
    expect(() => createMetaAuthorizationUrl({ configuration, loginMode: 'instagram-login',
      state: 'a'.repeat(32), scopes: ['instagram_business_basic'] })).toThrow(/not configured/);
  });

  it('discovers Facebook Pages only with messaging authority and keeps per-Page tokens server-side', async () => {
    const configuration = loadMetaOAuthConfiguration(base);
    const fetcher = async () => new Response(JSON.stringify({ data: [{
      id: 'page-1', name: 'Judith Serna Realtor', access_token: 'page-secret', tasks: ['MESSAGING'],
    }] }), { status: 200 });
    await expect(discoverMetaBusinessAssets({ configuration, loginMode: 'facebook-page',
      accessToken: 'user-secret', fetcher })).resolves.toMatchObject({
      assets: [{ channel: 'facebook', assetId: 'page-1', displayLabel: 'Judith Serna Realtor',
        accessToken: 'page-secret', accessTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) }],
      snapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('subscribes only the inbound messages field on the pinned graph version', async () => {
    let called = '';
    const configuration = loadMetaOAuthConfiguration(base);
    const result = await subscribeMetaBusinessAsset({ configuration,
      asset: { channel: 'facebook', assetId: 'page-1' }, accessToken: 'page-secret',
      fetcher: async (url) => { called = String(url); return new Response('{"success":true}', { status: 200 }); },
    });
    expect(called).toContain('/v99.0/page-1/subscribed_apps?subscribed_fields=messages');
    expect(result.subscriptionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unsubscribes the selected asset before revoking the bound Meta grant', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const configuration = loadMetaOAuthConfiguration(base);
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response('{"success":true}', { status: 200 });
    };
    await expect(unsubscribeMetaBusinessAsset({ configuration,
      asset: { channel: 'facebook', assetId: 'page-1' }, accessToken: 'page-secret', fetcher,
    })).resolves.toMatchObject({ assetIdHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    await expect(revokeMetaOAuthGrant({ configuration, loginMode: 'facebook-page',
      accessToken: 'user-secret', fetcher,
    })).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toEqual([
      { url: 'https://graph.facebook.com/v99.0/page-1/subscribed_apps', method: 'DELETE' },
      { url: 'https://graph.facebook.com/v99.0/me/permissions', method: 'DELETE' },
    ]);
  });
});
