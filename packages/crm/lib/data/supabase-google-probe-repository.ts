import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}
function integer(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConnectorError('conflict', `${field} is invalid.`);
  return parsed;
}
function envelope(value: unknown) {
  const row = object(value, 'Google probe secret envelope is invalid.');
  const secret: ConnectorSecretEnvelope & { readonly secretVersion: number; readonly expiresAt?: string } = {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'), secretVersion: integer(row.secretVersion, 'secretVersion'),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
  };
  return secret;
}
function failure(message: string, error: { code?: string }): never {
  if (error.code === '42501') throw new ConnectorError('forbidden', message);
  if (error.code === 'P0002') throw new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', message);
  if (['22023', '23514'].includes(error.code ?? '')) throw new ConnectorError('invalid-input', message);
  throw new Error(`${message}: persistence failed.`);
}

export interface GoogleProbeAuthority {
  readonly workspaceId: string; readonly connectionId: string; readonly displayLabel: string;
  readonly accountKeyHash: string; readonly grantedScopes: readonly string[];
  readonly gmailProfileCheckAvailable: boolean; readonly accessState: 'live' | 'refresh-required';
  readonly access: ReturnType<typeof envelope>; readonly refresh?: ReturnType<typeof envelope>;
}

export function supabaseGoogleProbeRepository(service: SupabaseClient) {
  return {
    async read(scope: WorkspaceScope, connectionId: string, now: string): Promise<GoogleProbeAuthority> {
      const { data, error } = await service.rpc('read_google_connection_probe_authority', {
        target_connection_id: connectionId, target_actor_user_id: scope.authenticatedUserId,
        target_membership_id: scope.membershipId, target_now: now,
      });
      if (error) failure('Failed to read Google probe authority', error);
      const row = object(data, 'Google probe authority is invalid.');
      const access = envelope(row.accessEnvelope);
      const refresh = row.refreshEnvelope ? envelope(row.refreshEnvelope) : undefined;
      if (row.workspaceId !== scope.workspaceId || row.connectionId !== connectionId
        || !['live', 'refresh-required'].includes(String(row.accessState))
        || !Array.isArray(row.grantedScopes) || !row.grantedScopes.every((value) => typeof value === 'string')) {
        throw new ConnectorError('conflict', 'Google probe authority is not bound to this workspace.');
      }
      return {
        workspaceId: scope.workspaceId, connectionId, displayLabel: text(row.displayLabel, 'displayLabel'),
        accountKeyHash: text(row.accountKeyHash, 'accountKeyHash'), grantedScopes: row.grantedScopes as string[],
        gmailProfileCheckAvailable: row.gmailProfileCheckAvailable === true,
        accessState: row.accessState as 'live' | 'refresh-required', access,
        ...(refresh ? { refresh } : {}),
      };
    },
    async refresh(scope: WorkspaceScope, input: { connectionId: string; expectedVersion: number;
      accessEnvelope: Record<string, unknown>; occurredAt: string; correlationId: string }) {
      const { error } = await service.rpc('refresh_google_connection_probe_access_token', {
        target_connection_id: input.connectionId, target_actor_user_id: scope.authenticatedUserId,
        target_membership_id: scope.membershipId, target_expected_access_secret_version: input.expectedVersion,
        target_access_envelope: input.accessEnvelope, target_occurred_at: input.occurredAt,
        target_correlation_id: input.correlationId,
      });
      if (error) failure('Failed to refresh Google probe access token', error);
    },
    async record(scope: WorkspaceScope, input: { connectionId: string;
      outcome: 'healthy' | 'degraded' | 'reauthorization-required'; accountHash: string; emailHash: string;
      evidenceHash: string; errorCategory?: string; occurredAt: string; correlationId: string }) {
      const { data, error } = await service.rpc('record_google_connection_probe', {
        target_connection_id: input.connectionId, target_actor_user_id: scope.authenticatedUserId,
        target_membership_id: scope.membershipId, target_outcome: input.outcome,
        target_observed_account_key_hash: input.accountHash, target_observed_email_hash: input.emailHash,
        target_provider_evidence_hash: input.evidenceHash, target_error_category: input.errorCategory ?? null,
        target_occurred_at: input.occurredAt, target_correlation_id: input.correlationId,
      });
      if (error) failure('Failed to record Google provider probe', error);
      return object(data, 'Google provider probe result is invalid.');
    },
  };
}

export type GoogleProbeRepository = ReturnType<typeof supabaseGoogleProbeRepository>;
