import { isCanonicalWorkspaceOwnerScope, type WorkspaceScope } from '../domain/workspace.ts';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import type { GoogleProbeRepository } from '../data/supabase-google-probe-repository.ts';
import {
  GoogleWorkspaceClient, loadGoogleOAuthConfiguration, readGoogleAccountIdentity,
  refreshGoogleAccessToken, type GoogleFetch, type GoogleOAuthConfiguration,
} from '../providers/google-client.ts';
import {
  createEnvironmentKekResolver, decryptConnectorSecret, encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';

function tokenEnvelope(value: ReturnType<typeof encryptConnectorSecret>, expiresAt: string) {
  return { ciphertext: value.ciphertext, nonce: value.iv, authTag: value.tag,
    wrappedDek: value.encryptedDek, wrapNonce: value.encryptedDekIv, wrapAuthTag: value.encryptedDekTag,
    kekVersion: value.kekVersion, aadHash: value.aadHash, expiresAt };
}
function failure(error: unknown) {
  if (error instanceof ConnectorError && error.code === 'forbidden') {
    return { outcome: 'reauthorization-required' as const, errorCategory: 'authorization_revoked' };
  }
  if (error instanceof ConnectorError && error.code === 'provider-retryable') {
    return { outcome: 'degraded' as const, errorCategory: 'rate_limited' };
  }
  return { outcome: 'degraded' as const, errorCategory: 'provider_unavailable' };
}

export async function probeLiveGoogleConnection(input: {
  readonly repository: GoogleProbeRepository; readonly scope: WorkspaceScope; readonly connectionId: string;
  readonly correlationId: string; readonly now?: Date; readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: GoogleFetch; readonly oauthConfiguration?: GoogleOAuthConfiguration;
}) {
  if (input.scope.mode !== 'live' || !isCanonicalWorkspaceOwnerScope(input.scope)) {
    throw new ConnectorError('forbidden', 'A signed-in workspace owner is required.');
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  const connectionId = input.connectionId.trim();
  if (!connectionId) throw new ConnectorError('invalid-input', 'connectionId is required.');
  const occurredAt = now.toISOString();
  const authority = await input.repository.read(input.scope, connectionId, occurredAt);
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  let accessToken = decryptConnectorSecret(authority.access, {
    workspaceId: authority.workspaceId, connectionId, provider: 'google',
    secretType: 'google-access-token', recordVersion: authority.access.secretVersion,
  }, resolver);
  let accountHash = authority.accountKeyHash;
  let emailHash = sha256Hex(authority.displayLabel.trim().toLowerCase());
  try {
    if (authority.accessState === 'refresh-required') {
      if (!authority.refresh) throw new ConnectorError('forbidden', 'Google refresh authority is unavailable.');
      const refreshToken = decryptConnectorSecret(authority.refresh, {
        workspaceId: authority.workspaceId, connectionId, provider: 'google',
        secretType: 'google-refresh-token', recordVersion: authority.refresh.secretVersion,
      }, resolver);
      const refreshed = await refreshGoogleAccessToken({
        configuration: input.oauthConfiguration ?? loadGoogleOAuthConfiguration(), refreshToken,
        ...(input.fetcher ? { fetcher: input.fetcher } : {}),
      });
      if (refreshed.grantedScopes && authority.grantedScopes.some((scope) => !refreshed.grantedScopes!.includes(scope))) {
        throw new ConnectorError('forbidden', 'Google refreshed token lost an authorized scope.');
      }
      const version = authority.access.secretVersion + 1;
      const expiresAt = new Date(now.getTime() + refreshed.expiresInSeconds * 1_000).toISOString();
      const encrypted = encryptConnectorSecret(refreshed.accessToken, {
        workspaceId: authority.workspaceId, connectionId, provider: 'google',
        secretType: 'google-access-token', recordVersion: version,
      }, resolver);
      await input.repository.refresh(input.scope, { connectionId,
        expectedVersion: authority.access.secretVersion, accessEnvelope: tokenEnvelope(encrypted, expiresAt),
        occurredAt, correlationId: input.correlationId });
      accessToken = refreshed.accessToken;
    }
    const identity = await readGoogleAccountIdentity(accessToken, input.fetcher);
    accountHash = sha256Hex(identity.subject);
    emailHash = sha256Hex(identity.email.trim().toLowerCase());
    let profileHistoryHash: string | undefined;
    if (authority.gmailProfileCheckAvailable) {
      const profile = await new GoogleWorkspaceClient(accessToken, input.fetcher).probeProfile();
      if (profile.emailAddress.trim().toLowerCase() !== identity.email.trim().toLowerCase()) {
        throw new ConnectorError('forbidden', 'Google Gmail profile identity does not match OIDC identity.');
      }
      profileHistoryHash = sha256Hex(profile.historyId);
    }
    const evidenceHash = stablePayloadHash({ accountHash, emailHash,
      grantedScopes: authority.grantedScopes, profileHistoryHash: profileHistoryHash ?? null });
    const recorded = await input.repository.record(input.scope, { connectionId, outcome: 'healthy',
      accountHash, emailHash, evidenceHash, occurredAt, correlationId: input.correlationId });
    return { connectionId, healthy: true as const, status: 'active', probedAt: occurredAt,
      gmailProfileChecked: authority.gmailProfileCheckAvailable, noOp: recorded.noOp === true };
  } catch (error) {
    const mapped = failure(error);
    const evidenceHash = stablePayloadHash({ accountHash, emailHash, errorCategory: mapped.errorCategory });
    const recorded = await input.repository.record(input.scope, { connectionId, ...mapped,
      accountHash, emailHash, evidenceHash, occurredAt, correlationId: input.correlationId });
    return { connectionId, healthy: false as const, status: mapped.outcome,
      probedAt: occurredAt, errorCategory: mapped.errorCategory, noOp: recorded.noOp === true };
  }
}
