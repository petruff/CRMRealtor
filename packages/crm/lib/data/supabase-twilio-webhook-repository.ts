import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorSecretEnvelope,
} from '../security/connector-secret-envelope.ts';
import type { TwilioVerifiedWebhookEvent } from '../application/twilio-webhook-service.ts';

export interface TwilioWebhookReceipt {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly outcome: string;
}

function failure(error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', 'Twilio callback authority refused the event.');
  if (error.code === 'P0002') return new ConnectorError('not-found', 'Twilio callback connection was not found.');
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', 'Twilio callback was already processed.');
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', 'Twilio callback is invalid.');
  return new Error('Failed to persist Twilio callback: persistence failed.');
}

function bytea(base64: string): string {
  const value = Buffer.from(base64, 'base64');
  if (!value.length) throw new ConnectorError('invalid-input', 'Encrypted Twilio callback content is invalid.');
  return `\\x${value.toString('hex')}`;
}

function envelope(value: string, input: { workspaceId: string; connectionId: string }) {
  const encrypted = encryptConnectorSecret(value, {
    workspaceId: input.workspaceId, connectionId: input.connectionId, provider: 'twilio',
    secretType: 'twilio-inbound-body', recordVersion: 1,
  }, createEnvironmentKekResolver());
  return {
    ciphertext: bytea(encrypted.ciphertext), nonce: bytea(encrypted.iv), authTag: bytea(encrypted.tag),
    wrappedDek: bytea(encrypted.encryptedDek), wrapNonce: bytea(encrypted.encryptedDekIv),
    wrapAuthTag: bytea(encrypted.encryptedDekTag), kekVersion: encrypted.kekVersion,
    aadHash: encrypted.aadHash, expiresAt: null,
  };
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Twilio ${field} is invalid.`);
  return value;
}

function secret(row: Record<string, unknown>): { envelope: ConnectorSecretEnvelope; version: number; type: string } {
  const version = Number(row.secretVersion);
  if (!Number.isSafeInteger(version) || version < 1) throw new ConnectorError('conflict', 'Twilio secret version is invalid.');
  return {
    version, type: text(row.secretType, 'secretType'),
    envelope: {
      schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
      ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'),
      tag: text(row.authTag, 'authTag'), encryptedDek: text(row.wrappedDek, 'wrappedDek'),
      encryptedDekIv: text(row.wrapNonce, 'wrapNonce'), encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'),
      kekVersion: text(row.kekVersion, 'kekVersion'), aadHash: text(row.aadHash, 'aadHash'),
    },
  };
}

export interface TwilioCallbackVerificationAuthority {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly authToken: string;
  readonly accountSidHash: string;
  readonly senderKeyHash: string;
  readonly exactExternalUrlHash: string;
}

export function supabaseTwilioWebhookRepository(client: SupabaseClient) {
  return {
    async resolveVerification(input: {
      readonly endpointKey: string;
      readonly callbackKind: 'inbound' | 'status';
      readonly occurredAt: string;
    }): Promise<TwilioCallbackVerificationAuthority> {
      if (!input.endpointKey || input.endpointKey.length > 256) {
        throw new ConnectorError('configuration-required', 'Twilio callback endpoint authority is unavailable.');
      }
      const { data, error } = await client.rpc('read_twilio_callback_verification_authority', {
        target_endpoint_key_hash: sha256Hex(input.endpointKey), target_callback_kind: input.callbackKind,
        target_now: input.occurredAt,
      });
      if (error) throw failure(error);
      const row = object(data, 'Twilio callback authority is invalid.');
      const workspaceId = text(row.workspaceId, 'workspaceId');
      const connectionId = text(row.connectionId, 'connectionId');
      const encrypted = secret(object(row.secret, 'Twilio callback secret authority is invalid.'));
      if (encrypted.type !== 'twilio-webhook-auth-token') {
        throw new ConnectorError('conflict', 'Twilio callback secret type is invalid.');
      }
      return {
        workspaceId, connectionId,
        authToken: decryptConnectorSecret(encrypted.envelope, {
          workspaceId, connectionId, provider: 'twilio', secretType: encrypted.type,
          recordVersion: encrypted.version,
        }, createEnvironmentKekResolver()),
        accountSidHash: text(row.accountSidHash, 'accountSidHash'),
        senderKeyHash: text(row.senderKeyHash, 'senderKeyHash'),
        exactExternalUrlHash: text(row.exactExternalUrlHash, 'exactExternalUrlHash'),
      };
    },
    async ingest(input: {
      readonly event: TwilioVerifiedWebhookEvent;
      readonly endpointKey: string;
      readonly authority: TwilioCallbackVerificationAuthority;
      readonly correlationId: string;
      readonly occurredAt: string;
    }): Promise<TwilioWebhookReceipt> {
      const { event } = input;
      if (!input.endpointKey || input.endpointKey.length > 256) {
        throw new ConnectorError('configuration-required', 'Twilio callback endpoint authority is unavailable.');
      }
      const endpointKeyHash = sha256Hex(input.endpointKey);
      const { authority } = input;
      const { workspaceId, connectionId } = authority;
      if (authority.accountSidHash !== sha256Hex(event.accountSid)
        || authority.senderKeyHash !== event.senderKeyHash
        || authority.exactExternalUrlHash !== event.externalUrlHash) {
        throw new ConnectorError('forbidden', 'Twilio callback authority does not match the verified event.');
      }
      const keyword = event.optOutType?.toLowerCase() ?? 'none';
      const counterpart = event.kind === 'inbound' ? event.from : event.to;
      const callbackRpc = event.kind === 'status'
        ? 'register_and_apply_twilio_status_callback'
        : 'register_and_apply_twilio_callback';
      const sharedArguments = {
        target_endpoint_key_hash: endpointKeyHash,
        target_replay_key_hash: event.eventHash,
        target_raw_body_hash: event.rawBodyHash,
        target_parameters_hash: event.parametersHash,
        target_exact_external_url_hash: event.externalUrlHash,
        target_account_sid_hash: sha256Hex(event.accountSid),
        target_sender_key_hash: event.senderKeyHash,
        target_provider_message_sid: event.messageSid,
        target_normalized_counterpart_phone: counterpart,
        target_provider_status: event.deliveryState ?? null,
        target_error_category: event.errorCategory ?? null,
        target_provider_occurred_at: event.providerOccurredAt,
        target_received_at: input.occurredAt,
        target_correlation_id: input.correlationId,
      };
      const callbackArguments = event.kind === 'status' ? sharedArguments : {
        ...sharedArguments,
        target_callback_kind: event.kind,
        target_keyword_class: keyword,
        target_content_body_hash: event.bodyHash ?? null,
        target_content_envelope: event.body && keyword === 'none'
          ? envelope(event.body, { workspaceId, connectionId }) : null,
      };
      const { data, error } = await client.rpc(callbackRpc, callbackArguments);
      if (error) throw failure(error);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ConnectorError('conflict', 'Twilio callback receipt is invalid.');
      }
      const row = data as Record<string, unknown>;
      return {
        accepted: row.accepted === true,
        duplicate: row.noOp === true || row.duplicate === true,
        outcome: row.noOp === true ? 'duplicate'
          : row.suppression ? 'opted-out'
            : row.reviewRecord ? 'review'
              : row.message ? 'applied' : 'accepted',
      };
    },
  };
}
