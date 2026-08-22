import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';
import type { MailchimpOperationRepository } from './mailchimp-operation-repository.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', `${field} is invalid.`);
  return Number(value);
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ConnectorError('conflict', `${field} is invalid.`);
  }
  return value as string[];
}

function bytea(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ConnectorError('invalid-input', 'Connector encrypted material is invalid.');
  return `\\x${bytes.toString('hex')}`;
}

function secret(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'),
    tag: text(row.authTag, 'authTag'), encryptedDek: text(row.wrappedDek, 'wrappedDek'),
    encryptedDekIv: text(row.wrapNonce, 'wrapNonce'), encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'),
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

export function supabaseMailchimpOperationRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service: SupabaseClient;
}): MailchimpOperationRepository {
  return {
    async readConnectionAuthority(scope, connectionId) {
      const { data, error } = await input.service.rpc('read_mailchimp_access_token', {
        target_workspace_id: scope.workspaceId, target_connection_id: connectionId,
        target_authenticated_user_id: scope.authenticatedUserId, target_membership_id: scope.membershipId,
      });
      if (error) throw persistenceError('Failed to read Mailchimp account authority', error);
      const envelope = object(data, 'Mailchimp account authority is invalid.');
      const encrypted = object(envelope.secret, 'Mailchimp token envelope is missing.');
      const remote = await input.authenticated.from('connector_connections')
        .select('remote_identity_summary').eq('id', connectionId).single();
      if (remote.error) throw persistenceError('Failed to read Mailchimp account metadata', remote.error);
      const identity = object(object(remote.data, 'Mailchimp account metadata is invalid.').remote_identity_summary,
        'Mailchimp account identity is invalid.');
      return {
        workspaceId: text(envelope.workspaceId, 'workspaceId'),
        connectionId: text(envelope.connectionId, 'connectionId'),
        accountIdHash: text(envelope.providerAccountKeyHash, 'accountIdHash'),
        dataCenter: text(identity.dataCenter, 'dataCenter'),
        secretVersion: integer(encrypted.secretVersion, 'secretVersion'),
        grantedScopes: stringArray(envelope.grantedScopes, 'grantedScopes'),
        accessTokenEnvelope: secret(encrypted),
      };
    },

    async getSelectedAudience(scope, connectionId) {
      const { data, error } = await input.authenticated.from('mailchimp_audience_bindings')
        .select('id,connection_id,account_id_hash,data_center,audience_external_id,audience_name,mapping_version,selected_at,baseline_required,webhook_registration_required')
        .eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId)
        .is('replaced_at', null).maybeSingle();
      if (error) throw persistenceError('Failed to read selected Mailchimp audience', error);
      if (!data) return undefined;
      const row = object(data, 'Mailchimp audience binding is invalid.');
      return {
        id: text(row.id, 'bindingId'),
        connectionId: text(row.connection_id, 'connectionId'),
        accountIdHash: text(row.account_id_hash, 'accountIdHash'),
        dataCenter: text(row.data_center, 'dataCenter'),
        audienceId: text(row.audience_external_id, 'audienceId'),
        audienceName: text(row.audience_name, 'audienceName'),
        mappingVersion: integer(row.mapping_version, 'mappingVersion'),
        selectedAt: text(row.selected_at, 'selectedAt'),
        baselineRequired: row.baseline_required === true,
        webhookRegistrationRequired: row.webhook_registration_required === true,
      };
    },

    async hasLinkedMember(scope, value) {
      const { data, error } = await input.authenticated.from('mailchimp_member_links')
        .select('id').eq('workspace_id', scope.workspaceId).eq('connection_id', value.connectionId)
        .eq('subscriber_hash', value.subscriberHash).limit(1);
      if (error) throw persistenceError('Failed to verify Mailchimp member link', error);
      return Array.isArray(data) && data.length === 1;
    },

    async selectAudience(_scope, value) {
      const { data, error } = await input.authenticated.rpc('select_mailchimp_audience', {
        target_connection_id: value.connectionId, target_account_id_hash: value.accountIdHash,
        target_data_center: value.dataCenter, target_audience_external_id: value.audience.id,
        target_audience_name: value.audience.name, target_mapping_version: value.mappingVersion,
        target_correlation_id: value.correlationId, target_selected_at: value.selectedAt,
      });
      if (error) throw persistenceError('Failed to select Mailchimp audience', error);
      const envelope = object(data, 'Mailchimp audience selection is invalid.');
      const row = object(envelope.binding, 'Mailchimp audience binding is missing.');
      return { binding: {
        id: text(row.id, 'bindingId'),
        connectionId: text(row.connection_id, 'connectionId'),
        accountIdHash: text(row.account_id_hash, 'accountIdHash'),
        dataCenter: text(row.data_center, 'dataCenter'),
        audienceId: text(row.audience_external_id, 'audienceId'),
        audienceName: text(row.audience_name, 'audienceName'),
        mappingVersion: integer(row.mapping_version, 'mappingVersion'),
        selectedAt: text(row.selected_at, 'selectedAt'),
        baselineRequired: row.baseline_required === true,
        webhookRegistrationRequired: row.webhook_registration_required === true,
      }, noOp: envelope.noOp === true };
    },

    async ensureSyncPolicy(scope, value) {
      const { data, error } = await input.authenticated.rpc('ensure_mailchimp_sync_policy', {
        target_workspace_id: scope.workspaceId, target_correlation_id: value.correlationId,
        target_occurred_at: value.occurredAt,
      });
      if (error) throw persistenceError('Failed to ensure Mailchimp sync policy', error);
      const envelope = object(data, 'Mailchimp sync policy is invalid.');
      const row = object(envelope.policy, 'Mailchimp sync policy is missing.');
      return { id: text(row.id, 'policyId'), version: integer(row.version, 'policyVersion'), noOp: envelope.noOp === true };
    },

    async storeOperation(scope, value) {
      const encrypted = value.envelope;
      const { data, error } = await input.service.rpc('store_connector_payload_envelope', {
        target_connection_id: value.connectionId, target_payload_kind: 'audience.sync',
        target_schema_version: 'mailchimp-member-operation.v1',
        target_canonical_hash: value.operation.operationKey,
        target_ciphertext: bytea(encrypted.ciphertext), target_nonce: bytea(encrypted.iv),
        target_auth_tag: bytea(encrypted.tag), target_wrapped_dek: bytea(encrypted.encryptedDek),
        target_wrap_nonce: bytea(encrypted.encryptedDekIv), target_wrap_auth_tag: bytea(encrypted.encryptedDekTag),
        target_kek_version: encrypted.kekVersion, target_aad_hash: encrypted.aadHash,
      });
      if (error) throw persistenceError('Failed to store Mailchimp operation', error);
      const row = object(data, 'Mailchimp operation reference is invalid.');
      if (row.workspaceId !== scope.workspaceId || row.connectionId !== value.connectionId
        || row.canonicalHash !== value.operation.operationKey) {
        throw new ConnectorError('conflict', 'Mailchimp operation authority is invalid.');
      }
      return {
        payloadReference: text(row.payloadRef, 'payloadReference'),
        payloadHash: text(row.canonicalHash, 'payloadHash'),
        envelopeVersion: integer(row.envelopeVersion, 'envelopeVersion'),
      };
    },

    async recordProbe(scope, value) {
      const { data, error } = await input.service.rpc('record_connector_connection_state', {
        target_connection_id: value.connectionId,
        target_status: value.status.replaceAll('-', '_'),
        target_provider_account_key_hash: value.accountIdHash,
        target_granted_scopes: [...value.grantedScopes],
        target_remote_identity_summary: null,
        target_last_probe_at: value.occurredAt,
        target_last_error_category: value.errorCategory === 'none' ? null : value.errorCategory,
        target_correlation_id: value.correlationId,
      });
      if (error) throw persistenceError('Failed to record Mailchimp connection probe', error);
      const envelope = object(data, 'Mailchimp connection probe result is invalid.');
      const row = object(envelope.connection, 'Mailchimp connection probe omitted connection.');
      if (row.workspace_id !== scope.workspaceId || row.id !== value.connectionId || row.provider !== 'mailchimp') {
        throw new ConnectorError('conflict', 'Mailchimp connection probe authority is invalid.');
      }
      const status = text(row.status, 'status').replaceAll('_', '-');
      if (!['active', 'degraded', 'reauthorization-required'].includes(status)) {
        throw new ConnectorError('conflict', 'Mailchimp connection probe status is invalid.');
      }
      return { status: status as 'active' | 'degraded' | 'reauthorization-required', occurredAt: value.occurredAt, noOp: envelope.noOp === true };
    },
  };
}
