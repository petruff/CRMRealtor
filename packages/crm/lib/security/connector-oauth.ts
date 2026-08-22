import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConnectorError, type ConnectorProvider } from '../domain/connector.ts';

export interface ConnectorOAuthTransaction {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: Exclude<ConnectorProvider, 'contract-test'>;
  readonly actorMembershipId: string;
  readonly stateHash: string;
  readonly pkceVerifier: string;
  readonly redirectUri: string;
  readonly requestedScopes: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

export interface ConnectorOAuthStart {
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
  readonly transaction: ConnectorOAuthTransaction;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function allowedRedirect(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError('configuration-required', 'Connector OAuth redirect URI is invalid.');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new ConnectorError('configuration-required', 'Connector OAuth redirect URI must be HTTPS or loopback HTTP.');
  }
  return url.toString();
}

export function createConnectorOAuthTransaction(input: {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: Exclude<ConnectorProvider, 'contract-test'>;
  readonly actorMembershipId: string;
  readonly redirectUri: string;
  readonly requestedScopes: readonly string[];
  readonly now: Date;
  readonly ttlSeconds?: number;
}): ConnectorOAuthStart {
  const ttl = input.ttlSeconds ?? 600;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 1_800) {
    throw new ConnectorError('configuration-required', 'Connector OAuth transaction TTL is invalid.');
  }
  if (!Number.isFinite(input.now.getTime())) throw new ConnectorError('invalid-input', 'OAuth timestamp is invalid.');
  if (!input.requestedScopes.length || input.requestedScopes.length > 32
    || input.requestedScopes.some((scope) => !scope || scope.length > 256)) {
    throw new ConnectorError('invalid-input', 'Connector OAuth scopes are invalid.');
  }
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const createdAt = input.now.toISOString();
  return {
    state,
    codeChallenge: digest(verifier).toString('base64url'),
    codeChallengeMethod: 'S256',
    transaction: {
      id: input.id,
      workspaceId: input.workspaceId,
      provider: input.provider,
      actorMembershipId: input.actorMembershipId,
      stateHash: digest(state).toString('hex'),
      pkceVerifier: verifier,
      redirectUri: allowedRedirect(input.redirectUri),
      requestedScopes: [...new Set(input.requestedScopes)].sort(),
      createdAt,
      expiresAt: new Date(input.now.getTime() + ttl * 1_000).toISOString(),
    },
  };
}

export function verifyConnectorOAuthCallback(
  transaction: ConnectorOAuthTransaction,
  receivedState: string,
  now: Date,
): ConnectorOAuthTransaction {
  if (transaction.consumedAt) throw new ConnectorError('conflict', 'Connector OAuth transaction was already consumed.');
  if (!Number.isFinite(now.getTime()) || now.toISOString() > transaction.expiresAt) {
    throw new ConnectorError('forbidden', 'Connector OAuth transaction expired.');
  }
  const expected = Buffer.from(transaction.stateHash, 'hex');
  const received = digest(receivedState);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new ConnectorError('forbidden', 'Connector OAuth state verification failed.');
  }
  return { ...transaction, consumedAt: now.toISOString() };
}

/**
 * Binds an OAuth transaction to the current Supabase browser session without
 * persisting the access token or refresh-cookie value itself.
 */
export function connectorOAuthSessionBindingHash(input: {
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly membershipId: string;
  readonly sessionId: string;
}): string {
  const values = [input.workspaceId, input.actorUserId, input.membershipId, input.sessionId];
  if (values.some((value) => !value || value.length > 256 || /[\u0000-\u001f\u007f|]/.test(value))) {
    throw new ConnectorError('forbidden', 'Connector OAuth session binding is invalid.');
  }
  return digest(values.join('|')).toString('hex');
}
