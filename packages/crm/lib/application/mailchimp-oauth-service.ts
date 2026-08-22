import { randomBytes, randomUUID } from 'node:crypto';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type { MailchimpOAuthRepository } from '../data/mailchimp-oauth-repository.ts';
import {
  createMailchimpAuthorizationUrl,
  exchangeMailchimpOAuthCode,
  type MailchimpFetch,
  type MailchimpOAuthConfiguration,
} from '../providers/mailchimp-client.ts';
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

const MAILCHIMP_SCOPE_MARKERS = ['audience.sync', 'audience.reconcile'] as const;
const OAUTH_SECRET_TYPE = 'oauth-pkce';
const ACCESS_TOKEN_SECRET_TYPE = 'mailchimp-access-token';

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

export function createMailchimpOAuthSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function beginMailchimpOAuth(input: {
  readonly repository: MailchimpOAuthRepository;
  readonly scope: WorkspaceScope;
  readonly actorUserId: string;
  readonly sessionSecret: string;
  readonly safeReturnPath: string;
  readonly connectionId?: string;
  readonly configuration: MailchimpOAuthConfiguration;
  readonly resolver?: ConnectorKekResolver;
  readonly now?: Date;
}) {
  const scope = owner(input.scope);
  if (input.actorUserId !== scope.authenticatedUserId) {
    throw new ConnectorError('forbidden', 'OAuth actor does not match the authenticated workspace owner.');
  }
  const now = input.now ?? new Date();
  const connectionId = input.connectionId?.trim() || randomUUID();
  const started = createConnectorOAuthTransaction({
    id: randomUUID(),
    workspaceId: scope.workspaceId,
    provider: 'mailchimp',
    actorMembershipId: scope.membershipId,
    redirectUri: input.configuration.redirectUri,
    requestedScopes: MAILCHIMP_SCOPE_MARKERS,
    now,
  });
  const sessionBindingHash = connectorOAuthSessionBindingHash({
    workspaceId: scope.workspaceId,
    actorUserId: scope.authenticatedUserId,
    membershipId: scope.membershipId,
    sessionId: input.sessionSecret,
  });
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  const verifierEnvelope = encryptConnectorSecret(started.transaction.pkceVerifier, {
    workspaceId: scope.workspaceId,
    connectionId,
    provider: 'mailchimp',
    secretType: OAUTH_SECRET_TYPE,
    recordVersion: 1,
  }, resolver);
  await input.repository.begin(scope, {
    connectionId,
    correlationId: randomUUID(),
    displayLabel: 'Mailchimp account',
    sessionBindingHash,
    safeReturnPath: returnPath(input.safeReturnPath),
    transaction: started.transaction,
    verifierEnvelope,
  });
  return {
    connectionId,
    authorizationUrl: createMailchimpAuthorizationUrl({
      configuration: input.configuration,
      state: started.state,
    }),
    expiresAt: started.transaction.expiresAt,
  };
}

export async function completeMailchimpOAuth(input: {
  readonly repository: MailchimpOAuthRepository;
  readonly scope: WorkspaceScope;
  readonly actorUserId: string;
  readonly sessionSecret: string;
  readonly state: string;
  readonly code: string;
  readonly configuration: MailchimpOAuthConfiguration;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: MailchimpFetch;
  readonly now?: Date;
}) {
  const scope = owner(input.scope);
  if (input.actorUserId !== scope.authenticatedUserId) {
    throw new ConnectorError('forbidden', 'OAuth actor does not match the authenticated workspace owner.');
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state)) {
    throw new ConnectorError('forbidden', 'Mailchimp OAuth state is invalid.');
  }
  const now = input.now ?? new Date();
  const sessionBindingHash = connectorOAuthSessionBindingHash({
    workspaceId: scope.workspaceId,
    actorUserId: scope.authenticatedUserId,
    membershipId: scope.membershipId,
    sessionId: input.sessionSecret,
  });
  const transaction = await input.repository.consume(scope, {
    stateHash: sha256Hex(input.state),
    sessionBindingHash,
    redirectUri: input.configuration.redirectUri,
    consumedAt: now.toISOString(),
  });
  if (transaction.provider !== 'mailchimp' || transaction.workspaceId !== scope.workspaceId) {
    throw new ConnectorError('forbidden', 'Mailchimp OAuth authority binding failed.');
  }
  const resolver = input.resolver ?? createEnvironmentKekResolver();
  // Authentication of this generic transaction nonce proves the private row is
  // still bound to the same workspace/connection before provider exchange.
  decryptConnectorSecret(transaction.verifierEnvelope, {
    workspaceId: scope.workspaceId,
    connectionId: transaction.connectionId,
    provider: 'mailchimp',
    secretType: OAUTH_SECRET_TYPE,
    recordVersion: 1,
  }, resolver);
  const exchange = await exchangeMailchimpOAuthCode({
    configuration: input.configuration,
    code: input.code,
    fetcher: input.fetcher,
  });
  const accessTokenEnvelope = encryptConnectorSecret(exchange.accessToken, {
    workspaceId: scope.workspaceId,
    connectionId: transaction.connectionId,
    provider: 'mailchimp',
    secretType: ACCESS_TOKEN_SECRET_TYPE,
    recordVersion: (transaction.expectedAccessSecretVersion ?? 0) + 1,
  }, resolver);
  await input.repository.complete(scope, {
    transactionId: transaction.transactionId,
    connectionId: transaction.connectionId,
    correlationId: randomUUID(),
    identity: exchange.identity,
    grantedScopes: MAILCHIMP_SCOPE_MARKERS,
    accessTokenEnvelope,
    ...(transaction.expectedAccessSecretVersion !== undefined
      ? { expectedAccessSecretVersion: transaction.expectedAccessSecretVersion }
      : {}),
    completedAt: now.toISOString(),
  });
  return {
    connectionId: transaction.connectionId,
    accountName: exchange.identity.accountName,
    dataCenter: exchange.identity.dataCenter,
    safeReturnPath: returnPath(transaction.safeReturnPath),
  };
}
