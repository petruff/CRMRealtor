import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';
import type { MetaOAuthRepository } from './meta-oauth-repository.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return value;
}
function version(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', 'Meta secret version is invalid.');
  return Number(value);
}
function failure(error: { code?: string }, message: string): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}
function encrypted(value: ConnectorSecretEnvelope, expiresAt: string | null) {
  return {
    ciphertext: value.ciphertext, nonce: value.iv, authTag: value.tag,
    wrappedDek: value.encryptedDek, wrapNonce: value.encryptedDekIv,
    wrapAuthTag: value.encryptedDekTag, kekVersion: value.kekVersion, aadHash: value.aadHash, expiresAt,
  };
}
function fromEnvelope(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'),
  };
}

export function supabaseMetaOAuthRepository(input: {
  authenticated: SupabaseClient; service: SupabaseClient;
}): MetaOAuthRepository {
  return {
    async begin(scope, value) {
      const { error } = await input.authenticated.rpc('begin_meta_oauth', {
        target_connection_id: value.connectionId, target_workspace_id: scope.workspaceId,
        target_login_mode: value.loginMode, target_graph_version: value.graphVersion,
        target_version_source_url: value.versionSourceUrl, target_version_source_hash: value.versionSourceHash,
        target_version_reviewed_at: value.versionReviewedAt, target_requested_scopes: [...value.requestedScopes],
        target_correlation_id: value.correlationId, target_state_hash: value.stateHash,
        target_session_binding_hash: value.sessionBindingHash, target_redirect_uri: value.redirectUri,
        target_safe_return_path: value.safeReturnPath, target_state_envelope: encrypted(value.stateEnvelope, null),
        target_expires_at: value.expiresAt, target_occurred_at: value.occurredAt,
      });
      if (error) throw failure(error, 'Meta OAuth could not start');
    },
    async consume(scope, value) {
      const { data, error } = await input.service.rpc('consume_meta_oauth_transaction', {
        target_state_hash: value.stateHash, target_workspace_id: scope.workspaceId,
        target_actor_user_id: scope.authenticatedUserId, target_membership_id: scope.membershipId,
        target_session_binding_hash: value.sessionBindingHash, target_redirect_uri: value.redirectUri,
        target_consumed_at: value.consumedAt,
      });
      if (error) throw failure(error, 'Meta OAuth transaction could not be consumed');
      const row = object(data, 'Meta OAuth transaction is invalid.');
      const requestedScopes = Array.isArray(row.requestedScopes) ? row.requestedScopes.map((item) => text(item, 'requested scope')) : [];
      const expectedAccessSecretVersion = version(row.expectedAccessSecretVersion);
      return {
        transactionId: text(row.transactionId, 'transactionId'), workspaceId: text(row.workspaceId, 'workspaceId'),
        connectionId: text(row.connectionId, 'connectionId'), loginMode: text(row.loginMode, 'loginMode') as 'facebook-page' | 'instagram-login',
        graphVersion: text(row.graphVersion, 'graphVersion'), requestedScopes,
        safeReturnPath: text(row.safeReturnPath, 'safeReturnPath'),
        stateEnvelope: fromEnvelope(object(row.stateEnvelope, 'Meta OAuth state envelope is invalid.')),
        ...(expectedAccessSecretVersion ? { expectedAccessSecretVersion } : {}),
      };
    },
    async complete(scope, value) {
      const { error } = await input.service.rpc('finalize_meta_oauth', {
        target_transaction_id: value.transactionId, target_workspace_id: scope.workspaceId,
        target_actor_user_id: scope.authenticatedUserId, target_membership_id: scope.membershipId,
        target_account_key_hash: value.accountKeyHash, target_granted_scopes: [...value.grantedScopes],
        target_business_verified: value.businessVerified,
        target_business_verification_hash: value.businessVerificationHash ?? null,
        target_app_review_approved: value.appReviewApproved,
        target_app_review_evidence_hash: value.appReviewEvidenceHash ?? null,
        target_expected_access_secret_version: value.expectedAccessSecretVersion ?? null,
        target_access_token_envelope: encrypted(value.accessTokenEnvelope, value.tokenExpiresAt),
        target_correlation_id: value.correlationId, target_occurred_at: value.occurredAt,
      });
      if (error) throw failure(error, 'Meta OAuth could not be finalized');
    },
  };
}

