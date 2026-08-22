import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type {
  CompleteMailchimpOAuthInput,
  ConsumedMailchimpOAuthTransaction,
  MailchimpOAuthRepository,
} from './mailchimp-oauth-repository.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

const MAILCHIMP_REQUESTED_SCOPES = ['audience.sync', 'audience.reconcile'] as const;

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('conflict', message);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function optionalVersion(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ConnectorError('conflict', 'Mailchimp secret version is invalid.');
  }
  return Number(value);
}

function bytea(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ConnectorError('invalid-input', 'Connector encrypted material is invalid.');
  return `\\x${bytes.toString('hex')}`;
}

function envelopeParameters(envelope: ConnectorSecretEnvelope) {
  return {
    ciphertext: bytea(envelope.ciphertext), nonce: bytea(envelope.iv), authTag: bytea(envelope.tag),
    wrappedDek: bytea(envelope.encryptedDek), wrapNonce: bytea(envelope.encryptedDekIv),
    wrapAuthTag: bytea(envelope.encryptedDekTag), kekVersion: envelope.kekVersion, aadHash: envelope.aadHash,
  };
}

function fromConsumed(row: Record<string, unknown>): ConsumedMailchimpOAuthTransaction {
  if (!Array.isArray(row.requestedScopes)) throw new ConnectorError('conflict', 'OAuth scopes are invalid.');
  if (row.requestedScopeBundle !== 'mailchimp.audience-sync.v1') {
    throw new ConnectorError('forbidden', 'OAuth scope bundle binding failed.');
  }
  const expectedAccessSecretVersion = optionalVersion(row.expectedAccessSecretVersion);
  return {
    transactionId: text(row.transactionId, 'transactionId'),
    workspaceId: text(row.workspaceId, 'workspaceId'),
    connectionId: text(row.connectionId, 'connectionId'),
    provider: 'mailchimp',
    requestedScopeBundle: 'mailchimp.audience-sync.v1',
    requestedScopes: row.requestedScopes.map((value) => text(value, 'requestedScope')),
    safeReturnPath: text(row.safeReturnPath, 'safeReturnPath'),
    verifierEnvelope: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.pkceCiphertext, 'pkceCiphertext'),
      iv: text(row.pkceNonce, 'pkceNonce'), tag: text(row.pkceAuthTag, 'pkceAuthTag'),
      encryptedDek: text(row.pkceWrappedDek, 'pkceWrappedDek'),
      encryptedDekIv: text(row.pkceWrapNonce, 'pkceWrapNonce'),
      encryptedDekTag: text(row.pkceWrapAuthTag, 'pkceWrapAuthTag'),
      kekVersion: text(row.kekVersion, 'kekVersion'), aadHash: text(row.aadHash, 'aadHash'),
    },
    ...(expectedAccessSecretVersion !== undefined ? { expectedAccessSecretVersion } : {}),
    consumedAt: text(row.consumedAt, 'consumedAt'),
  };
}

function persistenceError(message: string, error: { code?: string }): Error {
  const databaseCode = /^[A-Z0-9]{5}$/.test(error.code ?? '') ? error.code : 'unknown';
  console.error(JSON.stringify({
    schemaVersion: 'connector-persistence-error.v1',
    provider: 'mailchimp',
    operation: message,
    databaseCode,
  }));
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

/** Authenticated client starts; service-role client consumes/finalizes. */
export function supabaseMailchimpOAuthRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service: SupabaseClient;
}): MailchimpOAuthRepository {
  return {
    async begin(scope, value) {
      const envelope = envelopeParameters(value.verifierEnvelope);
      const { data, error } = await input.authenticated.rpc('begin_mailchimp_oauth_v2', {
        target_connection_id: value.connectionId,
        target_workspace_id: scope.workspaceId,
        target_display_label: value.displayLabel,
        target_correlation_id: value.correlationId,
        target_state_hash: value.transaction.stateHash,
        target_requested_scope_bundle: 'mailchimp.audience-sync.v1',
        // The production RPC binds this exact canonical order. The generic
        // OAuth helper sorts scopes for stable hashing, so do not forward its
        // alphabetic order across the persisted Mailchimp authority boundary.
        target_requested_scopes: [...MAILCHIMP_REQUESTED_SCOPES],
        target_session_binding_hash: value.sessionBindingHash,
        target_redirect_uri: value.transaction.redirectUri,
        target_safe_return_path: value.safeReturnPath,
        target_pkce_ciphertext: envelope.ciphertext,
        target_pkce_nonce: envelope.nonce,
        target_pkce_auth_tag: envelope.authTag,
        target_pkce_wrapped_dek: envelope.wrappedDek,
        target_pkce_wrap_nonce: envelope.wrapNonce,
        target_pkce_wrap_auth_tag: envelope.wrapAuthTag,
        target_kek_version: envelope.kekVersion,
        target_aad_hash: envelope.aadHash,
        target_expires_at: value.transaction.expiresAt,
        target_occurred_at: value.transaction.createdAt,
      });
      if (error) throw persistenceError('Failed to begin Mailchimp OAuth', error);
      const response = record(data, 'Mailchimp OAuth start returned an invalid envelope.');
      const transaction = record(response.oauthTransaction, 'Mailchimp OAuth start omitted its transaction.');
      return { connectionId: value.connectionId, transactionId: text(transaction.transactionId, 'transactionId') };
    },

    async consume(scope, value) {
      const { data, error } = await input.service.rpc('consume_mailchimp_oauth_transaction_v2', {
        target_state_hash: value.stateHash,
        target_workspace_id: scope.workspaceId,
        target_actor_user_id: scope.authenticatedUserId,
        target_membership_id: scope.membershipId,
        target_session_binding_hash: value.sessionBindingHash,
        target_redirect_uri: value.redirectUri,
        target_consumed_at: value.consumedAt,
      });
      if (error) throw persistenceError('Failed to consume Mailchimp OAuth', error);
      const response = fromConsumed(record(data, 'Mailchimp OAuth consume returned an invalid envelope.'));
      if (response.provider !== 'mailchimp') throw new ConnectorError('forbidden', 'OAuth provider binding failed.');
      return response;
    },

    async complete(scope, value: CompleteMailchimpOAuthInput) {
      const envelope = envelopeParameters(value.accessTokenEnvelope);
      const accountIdHash = sha256Hex(value.identity.accountId);
      const { data, error } = await input.service.rpc('finalize_mailchimp_oauth_v2', {
        target_transaction_id: value.transactionId,
        target_connection_id: value.connectionId,
        target_provider_account_key_hash: accountIdHash,
        target_granted_scopes: [...value.grantedScopes],
        target_remote_identity_summary: {
          accountIdHash, accountName: value.identity.accountName, dataCenter: value.identity.dataCenter,
        },
        target_ciphertext: envelope.ciphertext,
        target_nonce: envelope.nonce,
        target_auth_tag: envelope.authTag,
        target_wrapped_dek: envelope.wrappedDek,
        target_wrap_nonce: envelope.wrapNonce,
        target_wrap_auth_tag: envelope.wrapAuthTag,
        target_kek_version: envelope.kekVersion,
        target_aad_hash: envelope.aadHash,
        target_expected_access_secret_version: value.expectedAccessSecretVersion ?? null,
        target_occurred_at: value.completedAt,
        target_correlation_id: value.correlationId,
      });
      if (error) throw persistenceError('Failed to finalize Mailchimp OAuth', error);
      const response = record(data, 'Mailchimp OAuth completion returned an invalid envelope.');
      const connection = record(response.connection, 'Mailchimp OAuth completion omitted connection.');
      if (connection.workspace_id !== scope.workspaceId || connection.provider !== 'mailchimp'
        || connection.status !== 'active') {
        throw new ConnectorError('conflict', 'Mailchimp OAuth completion authority is invalid.');
      }
      return { connectionId: value.connectionId, status: 'active' };
    },
  };
}
