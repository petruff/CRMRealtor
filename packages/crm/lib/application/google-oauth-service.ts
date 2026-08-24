import { randomBytes, randomUUID } from 'node:crypto';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import {
  googleRequestedScopes,
  parseGoogleFeatureBundle,
  type GoogleFeatureBundle,
} from '../domain/google-connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { GoogleOAuthRepository } from '../data/google-oauth-repository.ts';
import {
  createGoogleAuthorizationUrl,
  exchangeGoogleOAuthCode,
  type GoogleFetch,
  type GoogleOAuthConfiguration,
} from '../providers/google-client.ts';
import {
  connectorOAuthSessionBindingHash,
  createConnectorOAuthTransaction,
} from '../security/connector-oauth.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';

const PKCE_SECRET_TYPE = 'oauth-pkce';
const ACCESS_TOKEN_SECRET_TYPE = 'google-access-token';
const REFRESH_TOKEN_SECRET_TYPE = 'google-refresh-token';

function owner(scopeInput: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.mode !== 'live' || scope.role !== 'owner') {
    throw new ConnectorError('forbidden', 'A signed-in workspace owner is required.');
  }
  return scope;
}

function returnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 512
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConnectorError('invalid-input', 'OAuth return path is invalid.');
  }
  return value;
}

function bundleFromScope(value: string): GoogleFeatureBundle {
  const match = /^google\.(workspace-core|gmail-send|gmail-metadata|calendar-app-created)\.v1$/.exec(value);
  if (!match) throw new ConnectorError('forbidden', 'Google OAuth scope bundle binding failed.');
  return parseGoogleFeatureBundle(match[1]);
}

export function createGoogleOAuthSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function beginGoogleOAuth(input: {
  readonly repository: GoogleOAuthRepository;
  readonly scope: WorkspaceScope;
  readonly actorUserId: string;
  readonly sessionSecret: string;
  readonly safeReturnPath: string;
  readonly bundle: GoogleFeatureBundle;
  readonly connectionId?: string;
  readonly configuration: GoogleOAuthConfiguration;
  readonly resolver?: ConnectorKekResolver;
  readonly now?: Date;
}) {
  const scope = owner(input.scope);
  if (input.actorUserId !== scope.authenticatedUserId) {
    throw new ConnectorError('forbidden', 'OAuth actor does not match the authenticated workspace owner.');
  }
  const now = input.now ?? new Date();
  const connectionId = input.connectionId?.trim() || randomUUID();
  const bundle = parseGoogleFeatureBundle(input.bundle);
  const started = createConnectorOAuthTransaction({
    id: randomUUID(), workspaceId: scope.workspaceId, provider: 'google',
    actorMembershipId: scope.membershipId, redirectUri: input.configuration.redirectUri,
    requestedScopes: googleRequestedScopes(bundle), now,
  });
  const sessionBindingHash = connectorOAuthSessionBindingHash({
    workspaceId: scope.workspaceId, actorUserId: scope.authenticatedUserId,
    membershipId: scope.membershipId, sessionId: input.sessionSecret,
  });
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  const verifierEnvelope = encryptConnectorSecret(started.transaction.pkceVerifier, {
    workspaceId: scope.workspaceId, connectionId, provider: 'google',
    secretType: PKCE_SECRET_TYPE, recordVersion: 1,
  }, resolver);
  await input.repository.begin(scope, {
    connectionId, correlationId: randomUUID(), displayLabel: 'Google account',
    sessionBindingHash, safeReturnPath: returnPath(input.safeReturnPath), bundle,
    transaction: started.transaction, verifierEnvelope,
  });
  return {
    connectionId, bundle,
    authorizationUrl: createGoogleAuthorizationUrl({
      configuration: input.configuration, state: started.state,
      codeChallenge: started.codeChallenge, bundle,
    }),
    expiresAt: started.transaction.expiresAt,
  };
}

export async function completeGoogleOAuth(input: {
  readonly repository: GoogleOAuthRepository;
  readonly scope: WorkspaceScope;
  readonly actorUserId: string;
  readonly sessionSecret: string;
  readonly state: string;
  readonly code: string;
  readonly configuration: GoogleOAuthConfiguration;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: GoogleFetch;
  readonly now?: Date;
}) {
  const scope = owner(input.scope);
  if (input.actorUserId !== scope.authenticatedUserId) {
    throw new ConnectorError('forbidden', 'OAuth actor does not match the authenticated workspace owner.');
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state)) {
    throw new ConnectorError('forbidden', 'Google OAuth state is invalid.');
  }
  const now = input.now ?? new Date();
  const sessionBindingHash = connectorOAuthSessionBindingHash({
    workspaceId: scope.workspaceId, actorUserId: scope.authenticatedUserId,
    membershipId: scope.membershipId, sessionId: input.sessionSecret,
  });
  const transaction = await input.repository.consume(scope, {
    stateHash: sha256Hex(input.state), sessionBindingHash,
    redirectUri: input.configuration.redirectUri, consumedAt: now.toISOString(),
  });
  if (transaction.provider !== 'google' || transaction.workspaceId !== scope.workspaceId) {
    throw new ConnectorError('forbidden', 'Google OAuth authority binding failed.');
  }
  const bundle = bundleFromScope(transaction.requestedScopeBundle);
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  const verifier = decryptConnectorSecret(transaction.verifierEnvelope, {
    workspaceId: scope.workspaceId, connectionId: transaction.connectionId,
    provider: 'google', secretType: PKCE_SECRET_TYPE, recordVersion: 1,
  }, resolver);
  const exchange = await exchangeGoogleOAuthCode({
    configuration: input.configuration, code: input.code,
    codeVerifier: verifier, requestedBundle: bundle, fetcher: input.fetcher,
  });
  const accessTokenEnvelope = encryptConnectorSecret(exchange.accessToken, {
    workspaceId: scope.workspaceId, connectionId: transaction.connectionId,
    provider: 'google', secretType: ACCESS_TOKEN_SECRET_TYPE,
    recordVersion: (transaction.expectedAccessSecretVersion ?? 0) + 1,
  }, resolver);
  const refreshTokenEnvelope = exchange.refreshToken
    ? encryptConnectorSecret(exchange.refreshToken, {
        workspaceId: scope.workspaceId, connectionId: transaction.connectionId,
        provider: 'google', secretType: REFRESH_TOKEN_SECRET_TYPE,
        recordVersion: (transaction.expectedRefreshSecretVersion ?? 0) + 1,
      }, resolver)
    : undefined;
  const completed = await input.repository.complete(scope, {
    transactionId: transaction.transactionId, connectionId: transaction.connectionId,
    correlationId: randomUUID(), bundle,
    identity: exchange.identity, grantedScopes: exchange.grantedScopes,
    accessTokenEnvelope, ...(refreshTokenEnvelope ? { refreshTokenEnvelope } : {}),
    ...(transaction.expectedAccessSecretVersion !== undefined
      ? { expectedAccessSecretVersion: transaction.expectedAccessSecretVersion } : {}),
    ...(transaction.expectedRefreshSecretVersion !== undefined
      ? { expectedRefreshSecretVersion: transaction.expectedRefreshSecretVersion } : {}),
    tokenExpiresAt: new Date(now.getTime() + exchange.expiresInSeconds * 1_000).toISOString(),
    completedAt: now.toISOString(),
  });
  return {
    connectionId: completed.connectionId, accountEmail: exchange.identity.email,
    grantedScopes: completed.grantedScopes, bundle,
    missingScopes: googleRequestedScopes(bundle).filter((scope) => (
      !completed.grantedScopes.includes(scope)
    )),
    safeReturnPath: returnPath(transaction.safeReturnPath),
  };
}
