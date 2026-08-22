import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';
import type {
  ConsumedGoogleOAuthTransaction,
  GoogleOAuthRepository,
} from './google-oauth-repository.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function optionalVersion(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', 'Secret version is invalid.');
  return Number(value);
}

function bytea(base64: string): string {
  const value = Buffer.from(base64, 'base64');
  if (!value.length) throw new ConnectorError('invalid-input', 'Encrypted Google material is invalid.');
  return `\\x${value.toString('hex')}`;
}

function encrypted(envelope: ConnectorSecretEnvelope, expiresAt: string | null) {
  return {
    ciphertext: envelope.ciphertext, nonce: envelope.iv, authTag: envelope.tag,
    wrappedDek: envelope.encryptedDek, wrapNonce: envelope.encryptedDekIv,
    wrapAuthTag: envelope.encryptedDekTag, kekVersion: envelope.kekVersion,
    aadHash: envelope.aadHash, expiresAt,
  };
}

function fromPkce(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.pkceCiphertext, 'pkceCiphertext'), iv: text(row.pkceNonce, 'pkceNonce'),
    tag: text(row.pkceAuthTag, 'pkceAuthTag'), encryptedDek: text(row.pkceWrappedDek, 'pkceWrappedDek'),
    encryptedDekIv: text(row.pkceWrapNonce, 'pkceWrapNonce'),
    encryptedDekTag: text(row.pkceWrapAuthTag, 'pkceWrapAuthTag'),
    kekVersion: text(row.kekVersion, 'kekVersion'), aadHash: text(row.aadHash, 'aadHash'),
  };
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

export function supabaseGoogleOAuthRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service: SupabaseClient;
}): GoogleOAuthRepository {
  return {
    async begin(scope, value) {
      const secret = value.verifierEnvelope;
      const { data, error } = await input.authenticated.rpc('begin_google_oauth', {
        target_connection_id: value.connectionId, target_workspace_id: scope.workspaceId,
        target_bundle: value.bundle, target_correlation_id: value.correlationId,
        target_state_hash: value.transaction.stateHash,
        target_session_binding_hash: value.sessionBindingHash,
        target_redirect_uri: value.transaction.redirectUri, target_safe_return_path: value.safeReturnPath,
        target_pkce_ciphertext: bytea(secret.ciphertext), target_pkce_nonce: bytea(secret.iv),
        target_pkce_auth_tag: bytea(secret.tag), target_pkce_wrapped_dek: bytea(secret.encryptedDek),
        target_pkce_wrap_nonce: bytea(secret.encryptedDekIv),
        target_pkce_wrap_auth_tag: bytea(secret.encryptedDekTag), target_kek_version: secret.kekVersion,
        target_aad_hash: secret.aadHash, target_expires_at: value.transaction.expiresAt,
        target_occurred_at: value.transaction.createdAt,
      });
      if (error) throw persistenceError('Failed to begin Google OAuth', error);
      const transaction = object(object(data, 'Google OAuth start is invalid.').transaction,
        'Google OAuth start omitted its transaction.');
      return { connectionId: value.connectionId, transactionId: text(transaction.transactionId, 'transactionId') };
    },

    async consume(scope, value) {
      const { data, error } = await input.service.rpc('consume_google_oauth_transaction', {
        target_state_hash: value.stateHash, target_workspace_id: scope.workspaceId,
        target_actor_user_id: scope.authenticatedUserId, target_membership_id: scope.membershipId,
        target_session_binding_hash: value.sessionBindingHash, target_redirect_uri: value.redirectUri,
        target_consumed_at: value.consumedAt,
      });
      if (error) throw persistenceError('Failed to consume Google OAuth', error);
      const row = object(data, 'Google OAuth transaction is invalid.');
      if (row.provider !== 'google' || !Array.isArray(row.requestedScopes)) {
        throw new ConnectorError('forbidden', 'Google OAuth provider or scope binding failed.');
      }
      const accessVersion = optionalVersion(row.expectedAccessSecretVersion);
      const refreshVersion = optionalVersion(row.expectedRefreshSecretVersion);
      return {
        transactionId: text(row.transactionId, 'transactionId'), workspaceId: text(row.workspaceId, 'workspaceId'),
        connectionId: text(row.connectionId, 'connectionId'), provider: 'google',
        requestedScopeBundle: `google.${text(row.bundle, 'bundle')}.v1`,
        requestedScopes: row.requestedScopes.map((item) => text(item, 'requestedScope')),
        safeReturnPath: text(row.safeReturnPath, 'safeReturnPath'), verifierEnvelope: fromPkce(row),
        ...(accessVersion !== undefined ? { expectedAccessSecretVersion: accessVersion } : {}),
        ...(refreshVersion !== undefined ? { expectedRefreshSecretVersion: refreshVersion } : {}),
        consumedAt: text(row.consumedAt, 'consumedAt'),
      } satisfies ConsumedGoogleOAuthTransaction;
    },

    async complete(scope, value) {
      const { data, error } = await input.service.rpc('finalize_google_oauth', {
        target_transaction_id: value.transactionId, target_workspace_id: scope.workspaceId,
        target_actor_user_id: scope.authenticatedUserId, target_membership_id: scope.membershipId,
        target_provider_account_key_hash: sha256Hex(value.identity.subject),
        target_account_email: value.identity.email, target_granted_scopes: [...value.grantedScopes],
        target_expected_access_secret_version: value.expectedAccessSecretVersion ?? null,
        target_access_envelope: encrypted(value.accessTokenEnvelope, value.tokenExpiresAt),
        target_expected_refresh_secret_version: value.expectedRefreshSecretVersion ?? null,
        target_refresh_envelope: value.refreshTokenEnvelope ? encrypted(value.refreshTokenEnvelope, null) : null,
        target_correlation_id: value.correlationId, target_occurred_at: value.completedAt,
      });
      if (error) throw persistenceError('Failed to finalize Google OAuth', error);
      const response = object(data, 'Google OAuth completion is invalid.');
      const connection = object(response.connection, 'Google OAuth completion omitted connection.');
      if (connection.workspace_id !== scope.workspaceId || connection.provider !== 'google'
        || connection.id !== value.connectionId || connection.status !== 'active'
        || !Array.isArray(connection.granted_scopes)) {
        throw new ConnectorError('conflict', 'Google OAuth completion authority is invalid.');
      }
      return {
        connectionId: value.connectionId, status: 'active',
        grantedScopes: connection.granted_scopes.map((item) => text(item, 'grantedScope')),
      };
    },
  };
}
