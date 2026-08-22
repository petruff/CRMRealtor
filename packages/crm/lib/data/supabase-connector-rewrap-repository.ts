import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, parseConnectorProvider, type ConnectorProvider } from '../domain/connector.ts';

export type ConnectorEnvelopeKind = 'payload' | 'connection-secret' | 'oauth-pkce' | 'sync-cursor';

export interface ConnectorKekVersionCount {
  readonly envelopeKind: ConnectorEnvelopeKind;
  readonly kekVersion: string;
  readonly activeCount: number;
}

export interface ConnectorKekRewrapCandidate {
  readonly claimId: string;
  readonly envelopeKind: ConnectorEnvelopeKind;
  readonly envelopeId: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly provider: ConnectorProvider;
  readonly secretType: string;
  readonly recordVersion: number;
  readonly sourceKekVersion: string;
  readonly targetKekVersion: string;
  readonly wrappedDek: string;
  readonly wrapNonce: string;
  readonly wrapAuthTag: string;
  readonly aadHash: string;
  readonly leaseExpiresAt: string;
  readonly fencingToken: number;
}

export interface ConnectorKekRewrapRepository {
  listVersionCounts(now: string): Promise<readonly ConnectorKekVersionCount[]>;
  claim(input: {
    workerId: string; sourceKekVersion: string; targetKekVersion: string;
    batchSize: number; leaseSeconds: number; now: string;
  }): Promise<readonly ConnectorKekRewrapCandidate[]>;
  complete(input: {
    candidate: ConnectorKekRewrapCandidate;
    workerId: string;
    wrappedDek: string;
    wrapNonce: string;
    wrapAuthTag: string;
    kekVersion: string;
    aadHash: string;
    now: string;
  }): Promise<{ readonly noOp: boolean }>;
}

function persistenceError(message: string, error: { code?: string; message: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('lease-lost', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

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

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ConnectorError('conflict', `${field} is invalid.`);
  }
  return value;
}

function envelopeKind(value: unknown): ConnectorEnvelopeKind {
  if (!['payload', 'connection-secret', 'oauth-pkce', 'sync-cursor'].includes(String(value))) {
    throw new ConnectorError('conflict', 'Connector envelope kind is invalid.');
  }
  return value as ConnectorEnvelopeKind;
}

function candidate(value: unknown): ConnectorKekRewrapCandidate {
  const row = record(value, 'Connector KEK rewrap candidate is invalid.');
  const recordVersion = integer(row.recordVersion, 'recordVersion');
  if (recordVersion < 1) throw new ConnectorError('conflict', 'recordVersion is invalid.');
  return {
    claimId: text(row.claimId, 'claimId'),
    envelopeKind: envelopeKind(row.envelopeKind),
    envelopeId: text(row.envelopeId, 'envelopeId'),
    workspaceId: text(row.workspaceId, 'workspaceId'),
    connectionId: text(row.connectionId, 'connectionId'),
    provider: parseConnectorProvider(row.provider),
    secretType: text(row.secretType, 'secretType'),
    recordVersion,
    sourceKekVersion: text(row.sourceKekVersion, 'sourceKekVersion'),
    targetKekVersion: text(row.targetKekVersion, 'targetKekVersion'),
    wrappedDek: text(row.wrappedDek, 'wrappedDek'),
    wrapNonce: text(row.wrapNonce, 'wrapNonce'),
    wrapAuthTag: text(row.wrapAuthTag, 'wrapAuthTag'),
    aadHash: text(row.aadHash, 'aadHash'),
    leaseExpiresAt: text(row.leaseExpiresAt, 'leaseExpiresAt'),
    fencingToken: integer(row.fencingToken, 'fencingToken'),
  };
}

function bytea(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ConnectorError('invalid-input', 'Rewrapped key material is invalid.');
  return `\\x${bytes.toString('hex')}`;
}

export function supabaseConnectorKekRewrapRepository(
  supabase: SupabaseClient,
): ConnectorKekRewrapRepository {
  return {
    async listVersionCounts(now) {
      const { data, error } = await supabase.rpc('list_connector_kek_version_counts', { target_now: now });
      if (error) throw persistenceError('Failed to list connector KEK version counts', error);
      return ((data ?? []) as unknown[]).map((value) => {
        const row = record(value, 'Connector KEK count row is invalid.');
        return {
          envelopeKind: envelopeKind(row.envelope_kind),
          kekVersion: text(row.kek_version, 'kek_version'),
          activeCount: Number(text(String(row.active_count), 'active_count')),
        };
      });
    },

    async claim(input) {
      const { data, error } = await supabase.rpc('claim_connector_kek_rewrap_candidates', {
        target_worker_id: input.workerId,
        target_source_kek_version: input.sourceKekVersion,
        target_target_kek_version: input.targetKekVersion,
        target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to claim connector KEK rewrap candidates', error);
      const envelope = record(data, 'Connector KEK rewrap claim response is invalid.');
      if (!Array.isArray(envelope.candidates)) {
        throw new ConnectorError('conflict', 'Connector KEK rewrap candidates are invalid.');
      }
      return envelope.candidates.map(candidate);
    },

    async complete(input) {
      const { data, error } = await supabase.rpc('cas_rewrap_connector_envelope', {
        target_claim_id: input.candidate.claimId,
        target_worker_id: input.workerId,
        target_fencing_token: input.candidate.fencingToken,
        target_wrapped_dek: bytea(input.wrappedDek),
        target_wrap_nonce: bytea(input.wrapNonce),
        target_wrap_auth_tag: bytea(input.wrapAuthTag),
        target_kek_version: input.kekVersion,
        target_aad_hash: input.aadHash,
        target_now: input.now,
      });
      if (error) throw persistenceError('Failed to persist connector KEK rewrap', error);
      const envelope = record(data, 'Connector KEK rewrap completion is invalid.');
      if (typeof envelope.noOp !== 'boolean') {
        throw new ConnectorError('conflict', 'Connector KEK rewrap completion state is invalid.');
      }
      return { noOp: envelope.noOp };
    },
  };
}
