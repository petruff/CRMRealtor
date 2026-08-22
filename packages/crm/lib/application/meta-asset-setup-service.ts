import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import { discoverMetaBusinessAssets, subscribeMetaBusinessAsset,
  type MetaFetch, type MetaOAuthConfiguration } from '../providers/meta-client.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret, encryptConnectorSecret,
  type ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return value;
}
function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return Number(value);
}
function failure(error: { code?: string }, message: string): never {
  if (error.code === '42501') throw new ConnectorError('forbidden', message);
  if (error.code === 'P0002') throw new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) throw new ConnectorError('invalid-input', message);
  throw new Error(`${message}: persistence failed.`);
}
function envelope(value: unknown): { envelope: ConnectorSecretEnvelope; version: number; expiresAt?: string } {
  const row = object(value, 'Meta secret envelope is invalid.');
  return {
    version: integer(row.secretVersion ?? row.envelopeVersion, 'secret version'),
    envelope: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'),
      tag: text(row.authTag, 'authTag'), encryptedDek: text(row.wrappedDek, 'wrappedDek'),
      encryptedDekIv: text(row.wrapNonce, 'wrapNonce'), encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'),
      kekVersion: text(row.kekVersion, 'kekVersion'), aadHash: text(row.aadHash, 'aadHash'),
    },
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
  };
}
function persisted(value: ConnectorSecretEnvelope, expiresAt: string | null = null) {
  return { ciphertext: value.ciphertext, nonce: value.iv, authTag: value.tag,
    wrappedDek: value.encryptedDek, wrapNonce: value.encryptedDekIv,
    wrapAuthTag: value.encryptedDekTag, kekVersion: value.kekVersion, aadHash: value.aadHash, expiresAt };
}
function owner(scope: WorkspaceScope) {
  if (scope.mode !== 'live' || scope.role !== 'owner') throw new ConnectorError('forbidden', 'A live workspace owner is required.');
}
function configured(value: string | undefined, name: string, pattern?: RegExp): string {
  const clean = value?.trim() ?? '';
  if (!clean || clean.length > 4_096 || /[\u0000-\u001f\u007f]/.test(clean) || (pattern && !pattern.test(clean))) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return clean;
}

async function discoveryAuthority(input: { service: SupabaseClient; scope: WorkspaceScope; connectionId: string; now: Date }) {
  const result = await input.service.rpc('read_meta_asset_discovery_authority', {
    target_connection_id: input.connectionId, target_authenticated_user_id: input.scope.authenticatedUserId,
    target_membership_id: input.scope.membershipId, target_now: input.now.toISOString(),
  });
  if (result.error) failure(result.error, 'Meta asset discovery authority is unavailable');
  const root = object(result.data, 'Meta discovery authority is invalid.');
  const connection = object(root.connection, 'Meta connection is invalid.');
  const authority = object(root.authority, 'Meta authority is invalid.');
  if (connection.workspace_id !== input.scope.workspaceId || connection.id !== input.connectionId) {
    throw new ConnectorError('forbidden', 'Meta discovery workspace binding failed.');
  }
  const secret = envelope(root.accessToken);
  const token = decryptConnectorSecret(secret.envelope, { workspaceId: input.scope.workspaceId,
    connectionId: input.connectionId, provider: 'meta', secretType: 'meta-access-token', recordVersion: secret.version },
  createEnvironmentKekResolver());
  return { token, loginMode: text(authority.login_mode, 'login mode') as 'facebook-page' | 'instagram-login',
    graphVersion: text(authority.graph_version, 'graph version') };
}

export async function discoverAndStageMetaAssets(input: {
  readonly service: SupabaseClient; readonly scope: WorkspaceScope; readonly connectionId: string;
  readonly configuration: MetaOAuthConfiguration; readonly environment?: Record<string, string | undefined>;
  readonly fetcher?: MetaFetch; readonly now?: Date;
}) {
  owner(input.scope);
  const now = input.now ?? new Date();
  const authority = await discoveryAuthority({ ...input, now });
  if (authority.graphVersion !== input.configuration.graphVersion) throw new ConnectorError('conflict', 'Meta Graph version changed.');
  const discovered = await discoverMetaBusinessAssets({ configuration: input.configuration,
    loginMode: authority.loginMode, accessToken: authority.token, fetcher: input.fetcher });
  const replaced = await input.service.rpc('replace_meta_eligible_assets', {
    target_connection_id: input.connectionId, target_graph_version: authority.graphVersion,
    target_snapshot_hash: discovered.snapshotHash,
    target_assets: discovered.assets.map((asset) => ({ channel: asset.channel, assetId: asset.assetId, displayLabel: asset.displayLabel })),
    target_occurred_at: now.toISOString(),
  });
  if (replaced.error) failure(replaced.error, 'Meta eligible assets could not be staged');
  if (authority.loginMode === 'facebook-page') {
    const resolver = createEnvironmentKekResolver(input.environment ?? process.env);
    const setup = await input.service.rpc('read_meta_page_token_setup_state', {
      target_connection_id: input.connectionId,
      target_authenticated_user_id: input.scope.authenticatedUserId,
      target_membership_id: input.scope.membershipId,
    });
    if (setup.error) failure(setup.error, 'Facebook Page token setup state is unavailable');
    const setupRoot = object(setup.data, 'Facebook Page token setup state is invalid.');
    const setupAssets = Array.isArray(setupRoot.assets) ? setupRoot.assets : [];
    const versions = new Map(setupAssets.map((value) => {
      const row = object(value, 'Facebook Page token setup asset is invalid.');
      const version = row.tokenVersion === null ? null : integer(row.tokenVersion, 'Page token version');
      return [text(row.assetIdHash, 'Page asset hash'), version] as const;
    }));
    const tokenBindings = discovered.assets.map((asset) => {
      if (!asset.accessToken || !asset.accessTokenHash) throw new ConnectorError('conflict', 'Facebook Page token is missing.');
      if (!versions.has(asset.assetIdHash)) throw new ConnectorError('conflict', 'Facebook Page token snapshot is incomplete.');
      const expectedVersion = versions.get(asset.assetIdHash) ?? null;
      const tokenVersion = (expectedVersion ?? 0) + 1;
      const plaintext = JSON.stringify({ accessToken: asset.accessToken, assetId: asset.assetId,
        assetIdHash: asset.assetIdHash, connectionId: input.connectionId, graphVersion: authority.graphVersion,
        tokenVersion, workspaceId: input.scope.workspaceId });
      const encrypted = encryptConnectorSecret(plaintext, { workspaceId: input.scope.workspaceId,
        connectionId: input.connectionId, provider: 'meta', secretType: 'meta-page-access-token', recordVersion: 1 }, resolver);
      return { assetIdHash: asset.assetIdHash, expectedTokenVersion: expectedVersion, tokenHash: asset.accessTokenHash,
        expiresAt: asset.tokenExpiresAt ?? null, envelope: persisted(encrypted, asset.tokenExpiresAt ?? null) };
    });
    const bound = await input.service.rpc('bind_meta_facebook_page_access_tokens', {
      target_connection_id: input.connectionId, target_graph_version: authority.graphVersion,
      target_snapshot_hash: discovered.snapshotHash, target_token_bindings: tokenBindings,
      target_occurred_at: now.toISOString(),
    });
    if (bound.error) failure(bound.error, 'Facebook Page token authority could not be stored');
  }
  return { connectionId: input.connectionId, loginMode: authority.loginMode,
    snapshotHash: discovered.snapshotHash, assets: discovered.assets.map(({ channel, assetIdHash, displayLabel }) => (
      { channel, assetIdHash, displayLabel }
    )) };
}

export async function selectAndSubscribeMetaAssets(input: {
  readonly authenticated: SupabaseClient; readonly service: SupabaseClient; readonly scope: WorkspaceScope;
  readonly connectionId: string; readonly snapshotHash: string; readonly assetHashes: readonly string[];
  readonly configuration: MetaOAuthConfiguration; readonly environment?: Record<string, string | undefined>;
  readonly fetcher?: MetaFetch; readonly now?: Date;
}) {
  owner(input.scope);
  const environment = input.environment ?? process.env;
  const now = input.now ?? new Date();
  const retentionDays = Number(configured(environment.META_RETENTION_DAYS, 'META_RETENTION_DAYS', /^\d{1,4}$/));
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) {
    throw new ConnectorError('configuration-required', 'META_RETENTION_DAYS is outside its approved range.');
  }
  const retentionHash = configured(environment.META_RETENTION_POLICY_HASH, 'META_RETENTION_POLICY_HASH', /^[0-9a-f]{64}$/);
  const selected = await input.authenticated.rpc('select_meta_assets', {
    target_connection_id: input.connectionId, target_snapshot_hash: input.snapshotHash,
    target_asset_hashes: [...input.assetHashes], target_retention_days: retentionDays,
    target_retention_policy_hash: retentionHash, target_correlation_id: randomUUID(), target_occurred_at: now.toISOString(),
  });
  if (selected.error) failure(selected.error, 'Meta assets could not be selected');
  const retry = await input.service.rpc('read_meta_asset_subscription_retry_authority', {
    target_connection_id: input.connectionId,
    target_authenticated_user_id: input.scope.authenticatedUserId,
    target_membership_id: input.scope.membershipId,
    target_now: now.toISOString(),
  });
  if (retry.error) failure(retry.error, 'Meta subscription retry authority is unavailable');
  const retryRoot = object(retry.data, 'Meta subscription retry authority is invalid.');
  if (retryRoot.workspaceId !== input.scope.workspaceId || retryRoot.connectionId !== input.connectionId) {
    throw new ConnectorError('forbidden', 'Meta subscription retry workspace binding failed.');
  }
  const loginMode = text(retryRoot.loginMode, 'login mode') as 'facebook-page' | 'instagram-login';
  const graphVersion = text(retryRoot.graphVersion, 'graph version');
  if (graphVersion !== input.configuration.graphVersion) throw new ConnectorError('conflict', 'Meta Graph version changed.');
  const connectionSecret = envelope(retryRoot.connectionAccessToken);
  const resolver = createEnvironmentKekResolver(environment);
  const connectionToken = decryptConnectorSecret(connectionSecret.envelope, { workspaceId: input.scope.workspaceId,
    connectionId: input.connectionId, provider: 'meta', secretType: 'meta-access-token',
    recordVersion: connectionSecret.version }, resolver);
  const selectedRows = Array.isArray(retryRoot.selectedAssets) ? retryRoot.selectedAssets as unknown[] : [];
  const selectedHashes = selectedRows.map((value) => text(object(value, 'Meta selected asset is invalid.').assetIdHash, 'asset hash')).sort();
  if (selectedHashes.join(',') !== [...input.assetHashes].sort().join(',')) {
    throw new ConnectorError('conflict', 'Meta selected-asset retry binding changed.');
  }
  const proofs: string[] = selectedRows.flatMap((value) => {
    const state = object(object(value, 'Meta selected asset is invalid.').subscriptionState,
      'Meta subscription state is invalid.');
    return state.status === 'subscribed' && typeof state.last_provider_evidence_hash === 'string'
      ? [state.last_provider_evidence_hash] : [];
  });
  for (const value of selectedRows) {
    const row = object(value, 'Meta selected asset is invalid.');
    if (row.retryAllowed !== true) continue;
    const assetIdHash = text(row.assetIdHash, 'asset hash');
    const channel = text(row.channel, 'channel') as 'facebook' | 'instagram';
    const attemptCorrelationId = randomUUID();
    const operationKeyHash = stablePayloadHash({ connectionId: input.connectionId, assetIdHash,
      graphVersion, operation: 'messages.subscribe', attemptCorrelationId });
    const attempted = await input.service.rpc('record_meta_asset_subscription_result', {
      target_connection_id: input.connectionId, target_asset_id_hash: assetIdHash,
      target_outcome: 'attempted', target_operation_key_hash: operationKeyHash,
      target_provider_evidence_hash: null, target_error_category: null,
      target_correlation_id: attemptCorrelationId, target_occurred_at: now.toISOString(),
    });
    if (attempted.error) failure(attempted.error, 'Meta subscription attempt could not be recorded');
    let assetId: string;
    let token: string;
    if (channel === 'facebook') {
      assetId = text(row.assetId, 'asset id');
      const pageToken = envelope(row.pageAccessToken);
      token = decryptConnectorSecret(pageToken.envelope, { workspaceId: input.scope.workspaceId,
        connectionId: input.connectionId, provider: 'meta', secretType: 'meta-page-access-token', recordVersion: 1 }, resolver);
      let parsed: Record<string, unknown>;
      try { parsed = object(JSON.parse(token), 'Facebook Page token plaintext is invalid.'); }
      catch { throw new ConnectorError('conflict', 'Facebook Page token plaintext is invalid.'); }
      if (Object.keys(parsed).sort().join(',') !== 'accessToken,assetId,assetIdHash,connectionId,graphVersion,tokenVersion,workspaceId') {
        throw new ConnectorError('forbidden', 'Facebook Page token schema binding failed.');
      }
      const accessToken = text(parsed.accessToken, 'Page access token');
      const tokenRow = object(row.pageAccessToken, 'Page token');
      if (parsed.assetId !== assetId || parsed.assetIdHash !== assetIdHash || parsed.workspaceId !== input.scope.workspaceId
        || parsed.connectionId !== input.connectionId || parsed.graphVersion !== graphVersion
        || parsed.tokenVersion !== integer(tokenRow.tokenVersion, 'Page token version')
        || sha256Hex(accessToken) !== text(tokenRow.canonicalHash, 'token hash')) {
        throw new ConnectorError('forbidden', 'Facebook Page token binding failed.');
      }
      token = accessToken;
    } else {
      if (loginMode !== 'instagram-login') throw new ConnectorError('forbidden', 'Meta subscription channel binding failed.');
      assetId = text(row.assetId, 'asset id');
      token = connectionToken;
    }
    try {
      const proof = await subscribeMetaBusinessAsset({ configuration: input.configuration,
        asset: { channel, assetId }, accessToken: token, fetcher: input.fetcher });
      const recorded = await input.service.rpc('record_meta_asset_subscription_result', {
        target_connection_id: input.connectionId, target_asset_id_hash: assetIdHash,
        target_outcome: 'subscribed', target_operation_key_hash: stablePayloadHash({ operationKeyHash, outcome: 'subscribed' }),
        target_provider_evidence_hash: proof.subscriptionHash, target_error_category: null,
        target_correlation_id: attemptCorrelationId, target_occurred_at: now.toISOString(),
      });
      if (recorded.error) failure(recorded.error, 'Meta subscription success could not be recorded');
      proofs.push(proof.subscriptionHash);
    } catch (error) {
      const recorded = await input.service.rpc('record_meta_asset_subscription_result', {
        target_connection_id: input.connectionId, target_asset_id_hash: assetIdHash,
        target_outcome: 'failed', target_operation_key_hash: stablePayloadHash({ operationKeyHash, outcome: 'failed' }),
        target_provider_evidence_hash: null, target_error_category: error instanceof ConnectorError
          && error.code === 'provider-retryable' ? 'provider_unavailable' : 'subscription_failed',
        target_correlation_id: attemptCorrelationId, target_occurred_at: now.toISOString(),
      });
      if (recorded.error) failure(recorded.error, 'Meta subscription failure could not be recorded');
      throw error;
    }
  }
  const endpointKey = configured(environment.META_WEBHOOK_ENDPOINT_KEY, 'META_WEBHOOK_ENDPOINT_KEY', /^[A-Za-z0-9_-]{16,256}$/);
  const appSecret = configured(environment.META_APP_SECRET, 'META_APP_SECRET');
  const verifyToken = configured(environment.META_WEBHOOK_VERIFY_TOKEN, 'META_WEBHOOK_VERIFY_TOKEN');
  const endpointHash = sha256Hex(endpointKey);
  const currentWebhook = await input.service.rpc('read_meta_webhook_authority', {
    target_endpoint_key_hash: endpointHash, target_now: now.toISOString(),
  });
  let appSecretVersion: number | null = null;
  let verifyTokenVersion: number | null = null;
  if (!currentWebhook.error) {
    const currentRoot = object(currentWebhook.data, 'Meta webhook authority is invalid.');
    appSecretVersion = integer(object(currentRoot.appSecret, 'Meta app secret state is invalid.').secretVersion, 'app secret version');
    verifyTokenVersion = integer(object(currentRoot.verifyToken, 'Meta verify token state is invalid.').secretVersion, 'verify token version');
  } else if (currentWebhook.error.code !== 'P0002') {
    failure(currentWebhook.error, 'Meta webhook setup state is unavailable');
  }
  const nextAppSecretVersion = (appSecretVersion ?? 0) + 1;
  const nextVerifyTokenVersion = (verifyTokenVersion ?? 0) + 1;
  const appEnvelope = encryptConnectorSecret(appSecret, { workspaceId: input.scope.workspaceId,
    connectionId: input.connectionId, provider: 'meta', secretType: 'meta-app-secret', recordVersion: nextAppSecretVersion }, resolver);
  const verifyEnvelope = encryptConnectorSecret(verifyToken, { workspaceId: input.scope.workspaceId,
    connectionId: input.connectionId, provider: 'meta', secretType: 'meta-webhook-verify-token', recordVersion: nextVerifyTokenVersion }, resolver);
  const bound = await input.service.rpc('bind_meta_webhook_authority', {
    target_connection_id: input.connectionId, target_endpoint_key_hash: endpointHash,
    target_expected_app_secret_version: appSecretVersion, target_app_secret_envelope: persisted(appEnvelope),
    target_expected_verify_token_version: verifyTokenVersion, target_verify_token_envelope: persisted(verifyEnvelope),
    target_subscription_evidence_hash: stablePayloadHash([...new Set(proofs)].sort()), target_correlation_id: randomUUID(),
    target_occurred_at: now.toISOString(),
  });
  if (bound.error) failure(bound.error, 'Meta webhook authority could not be bound');
  return { connectionId: input.connectionId, assetCount: selectedRows.length,
    subscribedCount: proofs.length, webhookBound: true };
}
