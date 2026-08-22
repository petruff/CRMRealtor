import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { GoogleCapabilityState, GoogleOperationRepository } from './google-operation-repository.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ConnectorError('conflict', `${field} is invalid.`);
  return Number(value);
}

function strings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ConnectorError('conflict', `${field} is invalid.`);
  }
  return value as string[];
}

function bytea(base64: string): string {
  const value = Buffer.from(base64, 'base64');
  if (!value.length) throw new ConnectorError('invalid-input', 'Encrypted Google material is invalid.');
  return `\\x${value.toString('hex')}`;
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function state(value: unknown): GoogleCapabilityState {
  const envelope = object(value, 'Google capability state is invalid.');
  const connection = object(envelope.connection, 'Google capability connection is invalid.');
  const tokenState = object(envelope.tokenState, 'Google token state is invalid.');
  const calendar = object(envelope.calendar, 'Google calendar state is invalid.');
  if (!Array.isArray(envelope.capabilities) || !Array.isArray(envelope.sync)) {
    throw new ConnectorError('conflict', 'Google capability collections are invalid.');
  }
  return {
    connection: {
      id: text(connection.id, 'connectionId'), workspaceId: text(connection.workspaceId, 'workspaceId'),
      status: text(connection.status, 'connectionStatus'), displayLabel: text(connection.displayLabel, 'displayLabel'),
      accountKeyHash: text(connection.accountKeyHash, 'accountKeyHash'),
      grantedScopes: strings(connection.grantedScopes, 'grantedScopes'),
      ...(typeof connection.lastProbeAt === 'string' ? { lastProbeAt: connection.lastProbeAt } : {}),
      ...(typeof connection.lastErrorCategory === 'string' ? { lastErrorCategory: connection.lastErrorCategory } : {}),
    },
    capabilities: envelope.capabilities.map((value) => {
      const row = object(value, 'Google capability row is invalid.');
      const bundle = text(row.bundle, 'bundle');
      if (!['gmail-send', 'gmail-metadata', 'calendar-app-created'].includes(bundle)
        || !['active', 'missing', 'revoked'].includes(String(row.state))) {
        throw new ConnectorError('conflict', 'Google capability contract is invalid.');
      }
      return {
        bundle: bundle as GoogleCapabilityState['capabilities'][number]['bundle'],
        requiredScopes: strings(row.required_scopes ?? row.requiredScopes, 'requiredScopes'),
        grantedScopes: strings(row.granted_scopes ?? row.grantedScopes, 'capabilityGrantedScopes'),
        state: row.state as GoogleCapabilityState['capabilities'][number]['state'],
        ...(typeof (row.authorized_at ?? row.authorizedAt) === 'string'
          ? { authorizedAt: String(row.authorized_at ?? row.authorizedAt) } : {}),
        ...(typeof (row.last_error_category ?? row.lastErrorCategory) === 'string'
          ? { lastErrorCategory: String(row.last_error_category ?? row.lastErrorCategory) } : {}),
      };
    }),
    sync: envelope.sync.map((value) => {
      const row = object(value, 'Google sync row is invalid.');
      const stream = String(row.stream_key ?? row.stream);
      const rowState = String(row.state);
      if (!['gmail-history', 'calendar-events'].includes(stream)
        || !['idle', 'syncing', 'healthy', 'full_resync_required', 'degraded'].includes(rowState)) {
        throw new ConnectorError('conflict', 'Google sync contract is invalid.');
      }
      return {
        stream: stream as GoogleCapabilityState['sync'][number]['stream'],
        state: rowState as GoogleCapabilityState['sync'][number]['state'],
        cursorGeneration: integer(row.cursor_generation ?? row.cursorGeneration ?? 0, 'cursorGeneration'),
        ...(typeof (row.last_success_at ?? row.lastSuccessAt) === 'string'
          ? { lastSuccessAt: String(row.last_success_at ?? row.lastSuccessAt) } : {}),
        ...(typeof (row.last_callback_at ?? row.lastCallbackAt) === 'string'
          ? { lastCallbackAt: String(row.last_callback_at ?? row.lastCallbackAt) } : {}),
        ...(Number.isSafeInteger(row.lag_seconds ?? row.lagSeconds)
          ? { lagSeconds: Number(row.lag_seconds ?? row.lagSeconds) } : {}),
        ...(typeof (row.last_error_category ?? row.lastErrorCategory) === 'string'
          ? { lastErrorCategory: String(row.last_error_category ?? row.lastErrorCategory) } : {}),
      };
    }),
    calendar: { created: calendar.created === true },
    tokenState: {
      ...(typeof tokenState.accessExpiresAt === 'string' ? { accessExpiresAt: tokenState.accessExpiresAt } : {}),
      refreshPresent: tokenState.refreshPresent === true,
    },
  };
}

export function supabaseGoogleOperationRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service?: SupabaseClient;
}): GoogleOperationRepository {
  return {
    async readCapabilityState(_scope, connectionId) {
      const { data, error } = await input.authenticated.rpc('read_google_connection_capability_state', {
        target_connection_id: connectionId,
      });
      if (error) throw persistenceError('Failed to read Google capability state', error);
      return state(data);
    },

    async storeEncryptedPayload(scope, value) {
      if (!input.service) throw new ConnectorError('configuration-required', 'Google payload authority is not configured.');
      const envelope = value.envelope;
      const { data, error } = await input.service.rpc('store_connector_payload_envelope', {
        target_connection_id: value.connectionId, target_payload_kind: value.payloadKind,
        target_schema_version: value.schemaVersion, target_canonical_hash: value.canonicalHash,
        target_ciphertext: bytea(envelope.ciphertext), target_nonce: bytea(envelope.iv),
        target_auth_tag: bytea(envelope.tag), target_wrapped_dek: bytea(envelope.encryptedDek),
        target_wrap_nonce: bytea(envelope.encryptedDekIv), target_wrap_auth_tag: bytea(envelope.encryptedDekTag),
        target_kek_version: envelope.kekVersion, target_aad_hash: envelope.aadHash,
      });
      if (error) throw persistenceError('Failed to store Google operation', error);
      const row = object(data, 'Google operation reference is invalid.');
      if (row.workspaceId !== scope.workspaceId || row.connectionId !== value.connectionId
        || row.canonicalHash !== value.canonicalHash) {
        throw new ConnectorError('conflict', 'Google operation authority is invalid.');
      }
      return {
        payloadReference: text(row.payloadRef, 'payloadReference'), payloadHash: text(row.canonicalHash, 'payloadHash'),
        envelopeVersion: integer(row.envelopeVersion, 'envelopeVersion'),
      };
    },

    async ensurePolicy(scope, value) {
      const { data, error } = await input.authenticated.from('connector_automation_policies')
        .select('id,version').eq('workspace_id', scope.workspaceId).eq('action_type', value.actionType)
        .eq('approval_mode', 'owner_required').order('version', { ascending: false }).limit(1).maybeSingle();
      if (error) throw persistenceError('Failed to read Google owner-approval policy', error);
      if (!data) throw new ConnectorError('configuration-required', 'Google owner-approval policy has not been initialized.');
      const row = object(data, 'Google policy is invalid.');
      return { id: text(row.id, 'policyId'), version: integer(row.version, 'policyVersion'), noOp: true };
    },
  };
}
