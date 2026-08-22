import { randomBytes, randomUUID } from 'node:crypto';
import type { MetaLoginMode, MetaOAuthRepository } from '../data/meta-oauth-repository.ts';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import { metaPermissionsForChannels } from '../domain/meta.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import { createMetaAuthorizationUrl, exchangeMetaOAuthCode, type MetaFetch, type MetaOAuthConfiguration } from '../providers/meta-client.ts';
import { connectorOAuthSessionBindingHash } from '../security/connector-oauth.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret, encryptConnectorSecret, type ConnectorKekResolver } from '../security/connector-secret-envelope.ts';

const STATE_SECRET_TYPE = 'oauth-pkce';
const ACCESS_SECRET_TYPE = 'meta-access-token';
function owner(scopeInput: WorkspaceScope) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.mode !== 'live' || scope.role !== 'owner') throw new ConnectorError('forbidden', 'A live workspace owner is required.');
  return scope;
}
function sessionHash(scope: WorkspaceScope, sessionSecret: string) {
  return connectorOAuthSessionBindingHash({
    workspaceId: scope.workspaceId, actorUserId: scope.authenticatedUserId,
    membershipId: scope.membershipId, sessionId: sessionSecret,
  });
}
function requested(loginMode: MetaLoginMode) {
  return metaPermissionsForChannels([loginMode === 'facebook-page' ? 'facebook-page' : 'instagram-business']);
}
function safePath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConnectorError('invalid-input', 'Meta OAuth return path is invalid.');
  }
  return value;
}
export function createMetaOAuthSessionSecret() { return randomBytes(32).toString('base64url'); }

export async function beginMetaOAuth(input: {
  repository: MetaOAuthRepository; scope: WorkspaceScope; actorUserId: string; sessionSecret: string;
  loginMode: MetaLoginMode; configuration: MetaOAuthConfiguration; safeReturnPath?: string;
  connectionId?: string; resolver?: ConnectorKekResolver; now?: Date;
}) {
  const scope = owner(input.scope);
  if (scope.authenticatedUserId !== input.actorUserId) throw new ConnectorError('forbidden', 'Meta OAuth actor mismatch.');
  const now = input.now ?? new Date();
  const state = randomBytes(32).toString('base64url');
  const connectionId = input.connectionId?.trim() || randomUUID();
  const scopes = requested(input.loginMode);
  const stateEnvelope = encryptConnectorSecret(state, {
    workspaceId: scope.workspaceId, connectionId, provider: 'meta', secretType: STATE_SECRET_TYPE, recordVersion: 1,
  }, input.resolver ?? createEnvironmentKekResolver());
  await input.repository.begin(scope, {
    connectionId, loginMode: input.loginMode, graphVersion: input.configuration.graphVersion,
    versionSourceUrl: input.configuration.versionSourceUrl,
    versionSourceHash: sha256Hex(input.configuration.versionSourceUrl),
    versionReviewedAt: input.configuration.versionVerifiedAt, requestedScopes: scopes,
    correlationId: randomUUID(), stateHash: sha256Hex(state), sessionBindingHash: sessionHash(scope, input.sessionSecret),
    redirectUri: input.configuration.redirectUri, safeReturnPath: safePath(input.safeReturnPath ?? '/connections'),
    stateEnvelope, expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(), occurredAt: now.toISOString(),
  });
  return {
    authorizationUrl: createMetaAuthorizationUrl({ configuration: input.configuration, loginMode: input.loginMode, state, scopes }),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

export async function completeMetaOAuth(input: {
  repository: MetaOAuthRepository; scope: WorkspaceScope; actorUserId: string; sessionSecret: string;
  state: string; code: string; configuration: MetaOAuthConfiguration; resolver?: ConnectorKekResolver;
  fetcher?: MetaFetch; environment?: Record<string, string | undefined>; now?: Date;
}) {
  const scope = owner(input.scope);
  if (scope.authenticatedUserId !== input.actorUserId || !/^[A-Za-z0-9_-]{32,256}$/.test(input.state)) {
    throw new ConnectorError('forbidden', 'Meta OAuth callback authority failed.');
  }
  const now = input.now ?? new Date();
  const transaction = await input.repository.consume(scope, {
    stateHash: sha256Hex(input.state), sessionBindingHash: sessionHash(scope, input.sessionSecret),
    redirectUri: input.configuration.redirectUri, consumedAt: now.toISOString(),
  });
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  const storedState = decryptConnectorSecret(transaction.stateEnvelope, {
    workspaceId: scope.workspaceId, connectionId: transaction.connectionId,
    provider: 'meta', secretType: STATE_SECRET_TYPE, recordVersion: 1,
  }, resolver);
  if (storedState !== input.state || transaction.workspaceId !== scope.workspaceId) {
    throw new ConnectorError('forbidden', 'Meta OAuth state binding failed.');
  }
  const exchange = await exchangeMetaOAuthCode({
    configuration: input.configuration, loginMode: transaction.loginMode, code: input.code,
    requestedScopes: transaction.requestedScopes, fetcher: input.fetcher,
  });
  const version = (transaction.expectedAccessSecretVersion ?? 0) + 1;
  const accessTokenEnvelope = encryptConnectorSecret(exchange.accessToken, {
    workspaceId: scope.workspaceId, connectionId: transaction.connectionId,
    provider: 'meta', secretType: ACCESS_SECRET_TYPE, recordVersion: version,
  }, resolver);
  const environment = input.environment ?? process.env;
  const businessHash = environment.OMNIX_CONNECTOR_META_BUSINESS_VERIFICATION_EVIDENCE?.trim();
  const appReviewHash = environment.OMNIX_CONNECTOR_META_APP_REVIEW_EVIDENCE?.trim();
  const businessVerified = environment.OMNIX_CONNECTOR_META_BUSINESS_VERIFIED?.trim().toLowerCase() === 'approved';
  const appReviewApproved = environment.OMNIX_CONNECTOR_META_APP_REVIEW_APPROVED?.trim().toLowerCase() === 'approved';
  if ((businessVerified && !/^[0-9a-f]{64}$/.test(businessHash ?? ''))
    || (appReviewApproved && !/^[0-9a-f]{64}$/.test(appReviewHash ?? ''))) {
    throw new ConnectorError('configuration-required', 'Meta approval requires immutable verification evidence hashes.');
  }
  await input.repository.complete(scope, {
    transactionId: transaction.transactionId, connectionId: transaction.connectionId,
    accountKeyHash: sha256Hex(exchange.accountId), grantedScopes: exchange.grantedScopes,
    businessVerified, ...(businessHash ? { businessVerificationHash: businessHash } : {}),
    appReviewApproved, ...(appReviewHash ? { appReviewEvidenceHash: appReviewHash } : {}),
    ...(transaction.expectedAccessSecretVersion !== undefined
      ? { expectedAccessSecretVersion: transaction.expectedAccessSecretVersion } : {}),
    accessTokenEnvelope, tokenExpiresAt: new Date(now.getTime() + exchange.expiresInSeconds * 1_000).toISOString(),
    correlationId: randomUUID(), occurredAt: now.toISOString(),
  });
  return { connectionId: transaction.connectionId, safeReturnPath: safePath(transaction.safeReturnPath), loginMode: transaction.loginMode };
}
