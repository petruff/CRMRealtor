import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex, type ConnectorJob } from '../domain/connector.ts';
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
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new ConnectorError('conflict', `${field} is invalid.`);
  return number;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function secret(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'),
  };
}

export interface TwilioEncryptedJobAuthority {
  readonly connectionId: string;
  readonly executionMode: 'send' | 'lookup-only';
  readonly payloadReference?: string;
  readonly payloadKind?: string;
  readonly payloadSchemaVersion?: string;
  readonly payloadVersion?: number;
  readonly payloadEnvelope?: ConnectorSecretEnvelope;
  readonly payloadHash?: string;
  readonly providerAuthorityEnvelope: ConnectorSecretEnvelope;
  readonly providerAuthorityVersion: number;
  readonly apiCredentialEnvelope: ConnectorSecretEnvelope;
  readonly apiCredentialVersion: number;
  readonly authority: {
    readonly approvedUseCase: string;
    readonly accountSidHash: string;
    readonly apiKeySidHash: string;
    readonly messagingServiceSidHash?: string;
    readonly senderKeyHash: string;
  };
  readonly approval: {
    readonly messageId: string;
    readonly draftId: string;
    readonly contactId: string;
    readonly contactPointId: string;
    readonly recipientPhoneHash: string;
    readonly consentEvidenceId: string;
    readonly recipientTimeZone?: string;
    readonly quietHoursStart: string;
    readonly quietHoursEnd: string;
    readonly approvedAt: string;
    readonly consentVersion: number;
    readonly policyVersion: number;
    readonly draftVersion: number;
  };
  readonly providerMessageBinding?: {
    readonly providerMessageSid: string;
    readonly providerMessageSidHash: string;
    readonly boundAt: string;
  };
}

function persistenceError(error: { code?: string }): never {
  if (error.code === '42501') throw new ConnectorError('lease-lost', 'Twilio job lease is no longer active.');
  if (error.code === 'P0002') throw new ConnectorError('not-found', 'Twilio job authority is unavailable.');
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', 'Twilio job authority changed.');
  throw new Error('Failed to read Twilio job authority: persistence failed.');
}

export function supabaseTwilioJobAuthorityReader(
  client: SupabaseClient,
  input: { readonly workerId: string; readonly now?: () => Date },
) {
  return {
    async read(job: ConnectorJob): Promise<TwilioEncryptedJobAuthority> {
      if (job.provider !== 'twilio' || job.actionType !== 'message.send'
        || job.state !== 'executing' || job.leaseOwner !== input.workerId) {
        throw new ConnectorError('lease-lost', 'Active Twilio job lease is required.');
      }
      const { data, error } = await client.rpc('read_twilio_job_authority', {
        target_job_id: job.id,
        target_worker_id: input.workerId,
        target_fencing_token: job.fencingToken,
        target_now: (input.now ?? (() => new Date()))().toISOString(),
      });
      if (error) persistenceError(error);
      const envelope = object(data, 'Twilio job authority is invalid.');
      const jobRow = object(envelope.job, 'Twilio authority omitted the job.');
      const connection = object(envelope.connection, 'Twilio connection authority is invalid.');
      const provider = object(envelope.authority, 'Twilio provider authority is invalid.');
      const approval = object(envelope.approvalSnapshot, 'Twilio approval snapshot is invalid.');
      const draftVersion = object(envelope.draftVersion, 'Twilio draft version authority is invalid.');
      const message = object(envelope.message, 'Twilio message authority is invalid.');
      const executionMode = envelope.executionMode;
      if (!['send', 'lookup-only'].includes(String(executionMode))) {
        throw new ConnectorError('conflict', 'Twilio execution mode is invalid.');
      }
      const payload = envelope.payloadEnvelope
        ? object(envelope.payloadEnvelope, 'Twilio payload authority is invalid.') : undefined;
      const binding = envelope.providerMessageBinding
        ? object(envelope.providerMessageBinding, 'Twilio provider binding is invalid.') : undefined;
      const providerSecret = object(envelope.providerAuthority, 'Twilio provider credential is invalid.');
      const apiSecret = object(envelope.apiCredential, 'Twilio API credential is invalid.');
      if (jobRow.id !== job.id || jobRow.workspace_id !== job.workspaceId
        || connection.id !== jobRow.connection_id || message.job_id !== job.id
        || (executionMode === 'send' && (!payload || payload.payloadRef !== job.payloadReference
          || payload.canonicalHash !== jobRow.payload_hash || binding))
        || draftVersion.id !== approval.draft_version_id
        || draftVersion.draft_id !== approval.draft_id
        || (executionMode === 'lookup-only' && (payload || !binding
          || !/^SM[A-Fa-f0-9]{32}$/.test(String(binding.providerMessageSid))
          || sha256Hex(String(binding.providerMessageSid)) !== binding.providerMessageSidHash
          || message.provider_message_sid_hash !== binding.providerMessageSidHash))) {
        throw new ConnectorError('conflict', 'Twilio leased job authority is inconsistent.');
      }
      return {
        connectionId: text(connection.id, 'connectionId'), executionMode: executionMode as 'send' | 'lookup-only',
        ...(payload ? {
          payloadReference: text(payload.payloadRef, 'payloadReference'),
          payloadKind: text(payload.payloadKind, 'payloadKind'),
          payloadSchemaVersion: text(payload.schemaVersion, 'payloadSchemaVersion'),
          payloadVersion: integer(payload.envelopeVersion, 'payloadVersion'),
          payloadEnvelope: secret(payload), payloadHash: text(payload.canonicalHash, 'payloadHash'),
        } : {}),
        providerAuthorityEnvelope: secret(providerSecret),
        providerAuthorityVersion: integer(providerSecret.secretVersion, 'providerAuthorityVersion'),
        apiCredentialEnvelope: secret(apiSecret),
        apiCredentialVersion: integer(apiSecret.secretVersion, 'apiCredentialVersion'),
        authority: {
          approvedUseCase: text(provider.approved_use_case, 'approvedUseCase'),
          accountSidHash: text(provider.account_sid_hash, 'accountSidHash'),
          apiKeySidHash: text(provider.api_key_sid_hash, 'apiKeySidHash'),
          ...(optionalText(provider.messaging_service_sid_hash) ? {
            messagingServiceSidHash: optionalText(provider.messaging_service_sid_hash),
          } : {}),
          senderKeyHash: text(provider.sender_key_hash, 'senderKeyHash'),
        },
        approval: {
          messageId: text(message.id, 'messageId'),
          draftId: text(approval.draft_id, 'draftId'),
          contactId: text(approval.contact_id, 'contactId'),
          contactPointId: text(approval.contact_point_id, 'contactPointId'),
          recipientPhoneHash: text(approval.recipient_phone_hash, 'recipientPhoneHash'),
          consentEvidenceId: text(approval.consent_event_id, 'consentEvidenceId'),
          ...(optionalText(approval.recipient_timezone) ? { recipientTimeZone: optionalText(approval.recipient_timezone) } : {}),
          quietHoursStart: text(approval.quiet_hours_start, 'quietHoursStart'),
          quietHoursEnd: text(approval.quiet_hours_end, 'quietHoursEnd'),
          approvedAt: text(approval.created_at, 'approvedAt'),
          consentVersion: integer(approval.texting_policy_version, 'consentVersion'),
          policyVersion: integer(approval.texting_policy_version, 'policyVersion'),
          draftVersion: integer(draftVersion.version, 'draftVersion'),
        },
        ...(binding ? { providerMessageBinding: {
          providerMessageSid: text(binding.providerMessageSid, 'providerMessageSid'),
          providerMessageSidHash: text(binding.providerMessageSidHash, 'providerMessageSidHash'),
          boundAt: text(binding.boundAt, 'providerMessageBoundAt'),
        } } : {}),
      };
    },
  };
}
