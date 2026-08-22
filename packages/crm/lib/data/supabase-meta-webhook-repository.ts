import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorSecretEnvelope,
} from '../security/connector-secret-envelope.ts';
import type {
  MetaWebhookAuthority,
  MetaWebhookHandlerRepository,
} from '../../app/api/connectors/meta/webhook/[endpointKey]/handler.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return Number(value);
}

function failure(error: { code?: string }, message: string): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function secretEnvelope(row: Record<string, unknown>): { envelope: ConnectorSecretEnvelope; version: number; type: string } {
  return {
    type: text(row.secretType, 'secretType'), version: integer(row.secretVersion, 'secretVersion'),
    envelope: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'),
      tag: text(row.authTag, 'authTag'), encryptedDek: text(row.wrappedDek, 'wrappedDek'),
      encryptedDekIv: text(row.wrapNonce, 'wrapNonce'), encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'),
      kekVersion: text(row.kekVersion, 'kekVersion'), aadHash: text(row.aadHash, 'aadHash'),
    },
  };
}

function persistenceEnvelope(encrypted: ConnectorSecretEnvelope) {
  return {
    ciphertext: encrypted.ciphertext, nonce: encrypted.iv, authTag: encrypted.tag,
    wrappedDek: encrypted.encryptedDek, wrapNonce: encrypted.encryptedDekIv,
    wrapAuthTag: encrypted.encryptedDekTag, kekVersion: encrypted.kekVersion,
    aadHash: encrypted.aadHash, expiresAt: null,
  };
}

export function supabaseMetaWebhookRepository(
  client: SupabaseClient,
  environment: Record<string, string | undefined> = process.env,
): MetaWebhookHandlerRepository {
  return {
    async resolveAuthority(input): Promise<MetaWebhookAuthority> {
      const { data, error } = await client.rpc('read_meta_webhook_authority', {
        target_endpoint_key_hash: sha256Hex(input.endpointKey), target_now: input.occurredAt,
      });
      if (error) throw failure(error, 'Meta webhook authority is unavailable');
      const row = object(data, 'Meta webhook authority is invalid.');
      const workspaceId = text(row.workspaceId, 'workspaceId');
      const connectionId = text(row.connectionId, 'connectionId');
      const decrypt = (value: unknown, expectedType: string) => {
        const authority = secretEnvelope(object(value, 'Meta webhook secret is invalid.'));
        if (authority.type !== expectedType) throw new ConnectorError('conflict', 'Meta webhook secret type is invalid.');
        return decryptConnectorSecret(authority.envelope, {
          workspaceId, connectionId, provider: 'meta', secretType: authority.type,
          recordVersion: authority.version,
        }, createEnvironmentKekResolver(environment));
      };
      const assets = Array.isArray(row.selectedAssets) ? row.selectedAssets : [];
      if (!assets.length) throw new ConnectorError('not-found', 'Meta selected asset authority is unavailable.');
      return {
        workspaceId, connectionId, graphVersion: text(row.graphVersion, 'graphVersion'),
        appSecret: decrypt(row.appSecret, 'meta-app-secret'),
        verifyToken: decrypt(row.verifyToken, 'meta-webhook-verify-token'),
        selectedAssetIds: assets.map((value) => text(object(value, 'Meta asset is invalid.').assetId, 'assetId')),
      };
    },

    async confirmChallenge(input) {
      const { error } = await client.rpc('confirm_meta_webhook_challenge', {
        target_endpoint_key_hash: input.endpointKeyHash,
        target_challenge_evidence_hash: input.challengeEvidenceHash,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw failure(error, 'Meta webhook challenge could not be confirmed');
    },

    async ingest(input) {
      const events = input.messages.map((message) => {
        const payload = JSON.stringify({
          schemaVersion: 'meta-inbound-message.v1', channel: message.channel,
          assetId: message.assetId, senderId: message.senderId, recipientId: message.recipientId,
          messageId: message.messageId, providerOccurredAt: message.providerOccurredAt,
          ...(message.text ? { text: message.text } : {}), attachmentTypes: message.attachmentTypes,
          contentHash: message.contentHash,
        });
        const encrypted = encryptConnectorSecret(payload, {
          workspaceId: input.authority.workspaceId, connectionId: input.authority.connectionId,
          provider: 'meta', secretType: 'meta-inbound-message', recordVersion: 1,
        }, createEnvironmentKekResolver(environment));
        return {
          ...message,
          envelope: persistenceEnvelope(encrypted),
        };
      });
      const replayKeyHash = stablePayloadHash({
        connectionId: input.authority.connectionId, bodyHash: input.bodyHash,
      });
      const { data, error } = await client.rpc('register_meta_webhook_delivery_encrypted', {
        target_endpoint_key_hash: input.endpointKeyHash, target_replay_key_hash: replayKeyHash,
        target_body_hash: input.bodyHash, target_graph_version: input.authority.graphVersion,
        target_signature_valid: true, target_events: events,
        target_received_at: input.occurredAt, target_correlation_id: input.correlationId,
      });
      if (error) throw failure(error, 'Meta webhook delivery could not be persisted');
      const result = object(data, 'Meta webhook receipt is invalid.');
      const count = (value: unknown, field: string) => {
        if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
        return Number(value);
      };
      return {
        accepted: count(result.accepted, 'accepted count'),
        duplicate: count(result.duplicate, 'duplicate count'),
        review: count(result.review, 'review count'),
      };
    },
  };
}
