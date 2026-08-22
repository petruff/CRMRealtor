import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import type { MetaLoginMode } from '../data/meta-oauth-repository.ts';

const MAX_RESPONSE_BYTES = 1_048_576;
export type MetaFetch = typeof fetch;

export interface MetaOAuthConfiguration {
  appId: string; appSecret: string; redirectUri: string; graphVersion: string;
  versionSourceUrl: string; versionVerifiedAt: string;
  facebookAuthorizationEndpoint: string; facebookTokenEndpoint: string;
  instagramAuthorizationEndpoint?: string; instagramTokenEndpoint?: string;
}
export interface MetaDiscoveredAsset {
  readonly channel: 'facebook' | 'instagram';
  readonly assetId: string;
  readonly assetIdHash: string;
  readonly displayLabel: string;
  readonly accessToken?: string;
  readonly accessTokenHash?: string;
  readonly tokenExpiresAt?: string;
}
function configured(value: string | undefined, name: string, max = 4_096): string {
  const clean = value?.trim() ?? '';
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return clean;
}
function endpoint(value: string, name: string, hosts: readonly string[]): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorError('configuration-required', `${name} is invalid.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !hosts.includes(url.hostname)) {
    throw new ConnectorError('configuration-required', `${name} must be an approved Meta HTTPS endpoint.`);
  }
  return url.toString();
}
export function loadMetaOAuthConfiguration(environment: Record<string, string | undefined> = process.env): MetaOAuthConfiguration {
  const graphVersion = configured(environment.META_GRAPH_API_VERSION, 'META_GRAPH_API_VERSION', 16);
  if (!/^v\d{2,3}\.0$/.test(graphVersion)) throw new ConnectorError('configuration-required', 'Meta Graph version is not pinned.');
  const redirectUri = configured(environment.META_REDIRECT_URI, 'META_REDIRECT_URI');
  const redirect = new URL(redirectUri);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(redirect.hostname);
  if (redirect.username || redirect.password || redirect.search || redirect.hash
    || redirect.pathname !== '/api/connectors/meta/callback'
    || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback))) {
    throw new ConnectorError('configuration-required', 'META_REDIRECT_URI must use the fixed Omnix callback path.');
  }
  return {
    appId: configured(environment.META_APP_ID, 'META_APP_ID'),
    appSecret: configured(environment.META_APP_SECRET, 'META_APP_SECRET'), redirectUri: redirect.toString(), graphVersion,
    versionSourceUrl: configured(environment.META_GRAPH_API_VERSION_SOURCE_URL, 'META_GRAPH_API_VERSION_SOURCE_URL'),
    versionVerifiedAt: configured(environment.META_GRAPH_API_VERSION_VERIFIED_AT, 'META_GRAPH_API_VERSION_VERIFIED_AT'),
    facebookAuthorizationEndpoint: endpoint(
      environment.META_FACEBOOK_AUTHORIZATION_ENDPOINT ?? `https://www.facebook.com/${graphVersion}/dialog/oauth`,
      'META_FACEBOOK_AUTHORIZATION_ENDPOINT', ['www.facebook.com'],
    ),
    facebookTokenEndpoint: endpoint(
      environment.META_FACEBOOK_TOKEN_ENDPOINT ?? `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
      'META_FACEBOOK_TOKEN_ENDPOINT', ['graph.facebook.com'],
    ),
    ...(environment.META_INSTAGRAM_AUTHORIZATION_ENDPOINT?.trim() ? {
      instagramAuthorizationEndpoint: endpoint(environment.META_INSTAGRAM_AUTHORIZATION_ENDPOINT,
        'META_INSTAGRAM_AUTHORIZATION_ENDPOINT', ['www.instagram.com']),
    } : {}),
    ...(environment.META_INSTAGRAM_TOKEN_ENDPOINT?.trim() ? {
      instagramTokenEndpoint: endpoint(environment.META_INSTAGRAM_TOKEN_ENDPOINT,
        'META_INSTAGRAM_TOKEN_ENDPOINT', ['api.instagram.com', 'graph.instagram.com']),
    } : {}),
  };
}

async function boundedJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new ConnectorError('provider-disabled', `${operation} response is too large.`);
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) throw new ConnectorError('provider-retryable', `${operation} is temporarily unavailable.`);
    throw new ConnectorError('forbidden', `${operation} was refused.`);
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch { throw new ConnectorError('provider-disabled', `${operation} returned invalid JSON.`); }
}

export function createMetaAuthorizationUrl(input: {
  configuration: MetaOAuthConfiguration; loginMode: MetaLoginMode; state: string; scopes: readonly string[];
}): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state) || !input.scopes.length) {
    throw new ConnectorError('invalid-input', 'Meta OAuth request is invalid.');
  }
  const authorizationEndpoint = input.loginMode === 'facebook-page'
    ? input.configuration.facebookAuthorizationEndpoint : input.configuration.instagramAuthorizationEndpoint;
  if (!authorizationEndpoint) {
    throw new ConnectorError('configuration-required', 'Instagram Business Login authorization endpoint is not configured.');
  }
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('client_id', input.configuration.appId);
  url.searchParams.set('redirect_uri', input.configuration.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', input.scopes.join(','));
  return url.toString();
}

export async function exchangeMetaOAuthCode(input: {
  configuration: MetaOAuthConfiguration; loginMode: MetaLoginMode; code: string;
  requestedScopes: readonly string[]; fetcher?: MetaFetch;
}): Promise<{ accessToken: string; expiresInSeconds: number; accountId: string; grantedScopes: readonly string[] }> {
  if (!input.code || input.code.length > 4_096 || /[\u0000-\u001f\u007f]/.test(input.code)) {
    throw new ConnectorError('invalid-input', 'Meta OAuth code is invalid.');
  }
  const fetcher = input.fetcher ?? fetch;
  const tokenEndpoint = input.loginMode === 'facebook-page'
    ? input.configuration.facebookTokenEndpoint : input.configuration.instagramTokenEndpoint;
  if (!tokenEndpoint) {
    throw new ConnectorError('configuration-required', 'Instagram Business Login token endpoint is not configured.');
  }
  const body = new URLSearchParams({
    client_id: input.configuration.appId, client_secret: input.configuration.appSecret,
    redirect_uri: input.configuration.redirectUri, code: input.code,
    ...(input.loginMode === 'instagram-login' ? { grant_type: 'authorization_code' } : {}),
  });
  const token = await boundedJson(await fetcher(tokenEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta OAuth token exchange');
  const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
  const expiresInSeconds = Number(token.expires_in ?? 3_600);
  if (!accessToken || accessToken.length > 16_384 || !Number.isInteger(expiresInSeconds)
    || expiresInSeconds < 60 || expiresInSeconds > 7_776_000) {
    throw new ConnectorError('forbidden', 'Meta returned an invalid access token.');
  }
  const graphHost = input.loginMode === 'facebook-page' ? 'graph.facebook.com' : 'graph.instagram.com';
  const identityUrl = new URL(`https://${graphHost}/${input.configuration.graphVersion}/me`);
  identityUrl.searchParams.set('fields', 'id');
  const identity = await boundedJson(await fetcher(identityUrl, {
    headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta account identity');
  const accountId = typeof identity.id === 'string' ? identity.id : '';
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(accountId)) throw new ConnectorError('provider-disabled', 'Meta account identity is invalid.');

  const permissionsUrl = new URL(`https://${graphHost}/${input.configuration.graphVersion}/me/permissions`);
  const permissions = await boundedJson(await fetcher(permissionsUrl, {
    headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta granted permissions');
  const data = Array.isArray(permissions.data) ? permissions.data : [];
  const grantedScopes = [...new Set(data.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return row.status === 'granted' && typeof row.permission === 'string' ? [row.permission] : [];
  }))].sort();
  if (input.requestedScopes.some((scope) => !grantedScopes.includes(scope))) {
    throw new ConnectorError('forbidden', 'Meta did not grant the exact requested permission set.');
  }
  return { accessToken, expiresInSeconds, accountId, grantedScopes };
}

function providerId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(value)) {
    throw new ConnectorError('provider-disabled', `Meta ${label} is invalid.`);
  }
  return value;
}

function providerLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConnectorError('provider-disabled', 'Meta business asset label is invalid.');
  }
  return value.trim();
}

export async function discoverMetaBusinessAssets(input: {
  readonly configuration: MetaOAuthConfiguration;
  readonly loginMode: MetaLoginMode;
  readonly accessToken: string;
  readonly fetcher?: MetaFetch;
}): Promise<{ readonly assets: readonly MetaDiscoveredAsset[]; readonly snapshotHash: string }> {
  if (!input.accessToken || input.accessToken.length > 16_384 || /[\u0000-\u001f\u007f]/.test(input.accessToken)) {
    throw new ConnectorError('forbidden', 'Meta discovery token is invalid.');
  }
  const fetcher = input.fetcher ?? fetch;
  const url = input.loginMode === 'facebook-page'
    ? new URL(`https://graph.facebook.com/${input.configuration.graphVersion}/me/accounts`)
    : new URL(`https://graph.instagram.com/${input.configuration.graphVersion}/me`);
  url.searchParams.set('fields', input.loginMode === 'facebook-page' ? 'id,name,access_token,tasks' : 'id,username');
  const response = await boundedJson(await fetcher(url, {
    headers: { authorization: `Bearer ${input.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta business asset discovery');
  const rows = input.loginMode === 'facebook-page' ? response.data : [response];
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new ConnectorError('provider-disabled', 'Meta returned no eligible business assets.');
  }
  const assets = rows.map((value): MetaDiscoveredAsset => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConnectorError('provider-disabled', 'Meta business asset is invalid.');
    }
    const row = value as Record<string, unknown>;
    const assetId = providerId(row.id, 'asset id');
    if (input.loginMode === 'facebook-page') {
      const tasks = Array.isArray(row.tasks) ? row.tasks : [];
      if (!tasks.some((task) => task === 'MESSAGING' || task === 'MODERATE')) {
        throw new ConnectorError('forbidden', 'The authorized account cannot manage messages for every returned Facebook Page.');
      }
      const accessToken = typeof row.access_token === 'string' ? row.access_token : '';
      if (!accessToken || accessToken.length > 16_384 || /[\u0000-\u001f\u007f]/.test(accessToken)) {
        throw new ConnectorError('provider-disabled', 'Facebook Page access token is invalid.');
      }
      return { channel: 'facebook', assetId, assetIdHash: sha256Hex(assetId),
        displayLabel: providerLabel(row.name), accessToken, accessTokenHash: sha256Hex(accessToken) };
    }
    return { channel: 'instagram', assetId, assetIdHash: sha256Hex(assetId), displayLabel: providerLabel(row.username) };
  }).sort((left, right) => left.assetIdHash.localeCompare(right.assetIdHash));
  return { assets, snapshotHash: stablePayloadHash(assets.map(({ channel, assetIdHash, displayLabel }) => (
    { channel, assetIdHash, displayLabel }
  ))) };
}

export async function subscribeMetaBusinessAsset(input: {
  readonly configuration: MetaOAuthConfiguration;
  readonly asset: Pick<MetaDiscoveredAsset, 'channel' | 'assetId'>;
  readonly accessToken: string;
  readonly fetcher?: MetaFetch;
}): Promise<{ readonly assetIdHash: string; readonly subscriptionHash: string }> {
  const assetId = providerId(input.asset.assetId, 'asset id');
  if (!input.accessToken || input.accessToken.length > 16_384) throw new ConnectorError('forbidden', 'Meta subscription token is invalid.');
  const host = input.asset.channel === 'facebook' ? 'graph.facebook.com' : 'graph.instagram.com';
  const url = new URL(`https://${host}/${input.configuration.graphVersion}/${assetId}/subscribed_apps`);
  url.searchParams.set('subscribed_fields', 'messages');
  const response = await boundedJson(await (input.fetcher ?? fetch)(url, {
    method: 'POST', headers: { authorization: `Bearer ${input.accessToken}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta business message webhook subscription');
  if (response.success !== true && response.success !== 'true') {
    throw new ConnectorError('provider-disabled', 'Meta did not confirm the business-message subscription.');
  }
  return { assetIdHash: sha256Hex(assetId), subscriptionHash: stablePayloadHash({
    assetIdHash: sha256Hex(assetId), channel: input.asset.channel, fields: ['messages'], success: true,
  }) };
}

export async function unsubscribeMetaBusinessAsset(input: {
  readonly configuration: MetaOAuthConfiguration;
  readonly asset: Pick<MetaDiscoveredAsset, 'channel' | 'assetId'>;
  readonly accessToken: string;
  readonly fetcher?: MetaFetch;
}): Promise<{ readonly assetIdHash: string; readonly evidenceHash: string }> {
  const assetId = providerId(input.asset.assetId, 'asset id');
  if (!input.accessToken || input.accessToken.length > 16_384) {
    throw new ConnectorError('forbidden', 'Meta unsubscribe token is invalid.');
  }
  const host = input.asset.channel === 'facebook' ? 'graph.facebook.com' : 'graph.instagram.com';
  const url = new URL(`https://${host}/${input.configuration.graphVersion}/${assetId}/subscribed_apps`);
  const response = await boundedJson(await (input.fetcher ?? fetch)(url, {
    method: 'DELETE', headers: { authorization: `Bearer ${input.accessToken}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta business message webhook unsubscribe');
  if (response.success !== true && response.success !== 'true') {
    throw new ConnectorError('provider-disabled', 'Meta did not confirm the business-message unsubscribe.');
  }
  const assetIdHash = sha256Hex(assetId);
  return { assetIdHash, evidenceHash: stablePayloadHash({
    assetIdHash, channel: input.asset.channel, fields: ['messages'], unsubscribed: true,
  }) };
}

export async function revokeMetaOAuthGrant(input: {
  readonly configuration: MetaOAuthConfiguration;
  readonly loginMode: MetaLoginMode;
  readonly accessToken: string;
  readonly fetcher?: MetaFetch;
}): Promise<string> {
  if (!input.accessToken || input.accessToken.length > 16_384) {
    throw new ConnectorError('forbidden', 'Meta revocation token is invalid.');
  }
  const host = input.loginMode === 'facebook-page' ? 'graph.facebook.com' : 'graph.instagram.com';
  const url = new URL(`https://${host}/${input.configuration.graphVersion}/me/permissions`);
  const response = await boundedJson(await (input.fetcher ?? fetch)(url, {
    method: 'DELETE', headers: { authorization: `Bearer ${input.accessToken}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  }), 'Meta OAuth grant revocation');
  if (response.success !== true && response.success !== 'true') {
    throw new ConnectorError('provider-disabled', 'Meta did not confirm OAuth grant revocation.');
  }
  return stablePayloadHash({ provider: 'meta', loginMode: input.loginMode, revoked: true });
}
