import { ConnectorError, stablePayloadHash, type ConnectorAdapterResult } from '../domain/connector.ts';
import type { ConnectorRevocationJob } from '../data/supabase-connector-revocation-repository.ts';
import { loadMetaOAuthConfiguration, revokeMetaOAuthGrant, unsubscribeMetaBusinessAsset,
  type MetaFetch } from '../providers/meta-client.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret,
  type ConnectorKekResolver, type ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

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
function envelope(value: unknown): { value: ConnectorSecretEnvelope; version: number; kind: string } {
  const row = object(value, 'Meta revocation secret envelope is invalid.');
  return { kind: text(row.secretType ?? row.payloadKind, 'secret type'),
    version: integer(row.secretVersion ?? row.envelopeVersion, 'secret version'),
    value: { schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
      encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
      encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
      aadHash: text(row.aadHash, 'aadHash') } };
}
function mapError(error: unknown): ConnectorAdapterResult {
  if (error instanceof ConnectorError) {
    if (error.code === 'provider-retryable') return { outcome: 'retryable-failure', errorCategory: 'provider_unavailable' };
    if (error.code === 'forbidden') return { outcome: 'terminal-failure', errorCategory: 'authorization_revoked' };
    if (['configuration-required', 'provider-disabled'].includes(error.code)) {
      return { outcome: 'terminal-failure', errorCategory: 'configuration_required' };
    }
    if (['conflict', 'invalid-input'].includes(error.code)) {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
  }
  return { outcome: 'unknown', errorCategory: 'network_outcome_unknown' };
}

export async function revokeMetaProviderConnection(input: {
  readonly job: ConnectorRevocationJob;
  readonly authority: unknown;
  readonly environment?: Record<string, string | undefined>;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: MetaFetch;
}): Promise<ConnectorAdapterResult> {
  try {
    const root = object(input.authority, 'Meta revocation authority is invalid.');
    const graphVersion = text(root.graphVersion, 'Graph version');
    const loginMode = text(root.loginMode, 'login mode') as 'facebook-page' | 'instagram-login';
    if (!['facebook-page', 'instagram-login'].includes(loginMode)) throw new ConnectorError('conflict', 'Meta login mode is invalid.');
    const configuration = loadMetaOAuthConfiguration(input.environment ?? process.env);
    if (configuration.graphVersion !== graphVersion) throw new ConnectorError('conflict', 'Meta revocation Graph version changed.');
    const resolver = input.resolver ?? createEnvironmentKekResolver(input.environment ?? process.env);
    const access = envelope(root.connectionAccessToken);
    if (access.kind !== 'meta-access-token') throw new ConnectorError('conflict', 'Meta access-token authority is invalid.');
    const connectionToken = decryptConnectorSecret(access.value, {
      workspaceId: input.job.workspaceId, connectionId: input.job.connectionId,
      provider: 'meta', secretType: access.kind, recordVersion: access.version,
    }, resolver);
    const evidence: string[] = [];
    const assets = Array.isArray(root.selectedAssets) ? root.selectedAssets : [];
    for (const raw of assets) {
      const asset = object(raw, 'Meta revocation asset is invalid.');
      const channel = text(asset.channel, 'asset channel') as 'facebook' | 'instagram';
      const assetId = text(asset.assetId, 'asset id');
      let token = connectionToken;
      if (channel === 'facebook') {
        const page = envelope(asset.pageAccessToken);
        if (page.kind !== 'meta-page-access-token') throw new ConnectorError('conflict', 'Facebook Page token authority is invalid.');
        const plaintext = decryptConnectorSecret(page.value, {
          workspaceId: input.job.workspaceId, connectionId: input.job.connectionId,
          provider: 'meta', secretType: page.kind, recordVersion: page.version,
        }, resolver);
        const parsed = object(JSON.parse(plaintext), 'Facebook Page token payload is invalid.');
        if (parsed.assetId !== assetId || parsed.connectionId !== input.job.connectionId
          || parsed.workspaceId !== input.job.workspaceId || parsed.graphVersion !== graphVersion) {
          throw new ConnectorError('conflict', 'Facebook Page token binding failed during revocation.');
        }
        token = text(parsed.accessToken, 'Page access token');
      }
      const result = await unsubscribeMetaBusinessAsset({ configuration, asset: { channel, assetId },
        accessToken: token, fetcher: input.fetcher });
      evidence.push(result.evidenceHash);
    }
    evidence.push(await revokeMetaOAuthGrant({ configuration, loginMode,
      accessToken: connectionToken, fetcher: input.fetcher }));
    return { outcome: 'succeeded', providerReceiptId: stablePayloadHash(evidence.sort()),
      providerStatus: 'provider-confirmed' };
  } catch (error) { return mapError(error); }
}
