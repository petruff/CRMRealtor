import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ConnectorError,
  sha256Hex,
  stablePayloadHash,
  type ConnectorJob,
} from '../domain/connector.ts';
import {
  evaluateTextingQuietHours,
  parseE164Phone,
  parseTextMessageBody,
} from '../domain/texting.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import { TwilioMessagingClient, type TwilioFetch } from './twilio-client.ts';
import type { TwilioApprovedSendOperation, TwilioJobAuthorityLoader } from './twilio-adapter.ts';
import type { ReturnTypeOfTwilioReader } from './supabase-twilio-authority-loader.types.ts';

function object(value: string, message: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch { throw new ConnectorError('conflict', message); }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], message: string): void {
  if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    throw new ConnectorError('conflict', message);
  }
}

function text(value: unknown, field: string, max = 4_096): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new ConnectorError('conflict', `${field} is invalid.`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new ConnectorError('conflict', `${field} is invalid.`);
  return number;
}

export function parseTwilioProviderAuthority(value: string) {
  const row = object(value, 'Twilio provider authority payload is invalid.');
  exactKeys(row, ['schemaVersion', 'accountSid', 'apiKeySid', 'messagingServiceSid', 'senderMode'],
    'Twilio provider authority payload contains unsupported fields.');
  const accountSid = text(row.accountSid, 'accountSid');
  const apiKeySid = text(row.apiKeySid, 'apiKeySid');
  const messagingServiceSid = text(row.messagingServiceSid, 'messagingServiceSid');
  if (row.schemaVersion !== 'twilio-provider-authority.v1'
    || !/^AC[A-Fa-f0-9]{32}$/.test(accountSid)
    || !/^SK[A-Fa-f0-9]{32}$/.test(apiKeySid)
    || !/^MG[A-Fa-f0-9]{32}$/.test(messagingServiceSid)
    || row.senderMode !== 'messaging_service') {
    throw new ConnectorError('conflict', 'Twilio provider authority is outside the approved contract.');
  }
  return { accountSid, apiKeySid, messagingServiceSid };
}

export function parseTwilioApiCredential(value: string): string {
  const row = object(value, 'Twilio API credential payload is invalid.');
  exactKeys(row, ['schemaVersion', 'apiKeySecret'], 'Twilio API credential contains unsupported fields.');
  if (row.schemaVersion !== 'twilio-api-key-secret.v1') {
    throw new ConnectorError('conflict', 'Twilio API credential schema is unsupported.');
  }
  return text(row.apiKeySecret, 'apiKeySecret');
}

function parseOperation(value: string, job: ConnectorJob, input: {
  readonly messageId: string;
  readonly draftId: string;
  readonly contactId: string;
  readonly contactPointId: string;
  readonly recipientPhoneHash: string;
  readonly consentEvidenceId: string;
  readonly useCase: string;
  readonly approvedAt: string;
  readonly consentVersion: number;
  readonly policyVersion: number;
  readonly draftVersion: number;
  readonly recipientTimeZone?: string;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly payloadHash: string;
  readonly connectionId: string;
}): TwilioApprovedSendOperation {
  const row = object(value, 'Twilio message payload is invalid.');
  exactKeys(row, [
    'schemaVersion', 'draftId', 'draftVersion', 'body', 'bodyHash',
    'recipientPhone', 'recipientPhoneHash', 'connectionId', 'reviewedAliasEpoch',
  ], 'Twilio message payload contains unsupported routing fields.');
  const body = parseTextMessageBody(row.body);
  const to = parseE164Phone(row.recipientPhone);
  const bodyHash = text(row.bodyHash, 'bodyHash');
  const recipientHash = text(row.recipientPhoneHash, 'recipientPhoneHash');
  if (row.schemaVersion !== 'twilio-message-body.v1'
    || text(row.connectionId, 'connectionId') !== input.connectionId
    || bodyHash !== sha256Hex(body) || bodyHash !== input.payloadHash
    || recipientHash !== sha256Hex(to) || recipientHash !== input.recipientPhoneHash
    || text(row.draftId, 'draftId') !== input.draftId
    || integer(row.draftVersion, 'draftVersion') !== input.draftVersion) {
    throw new ConnectorError('conflict', 'Twilio message payload does not match its approval authority.');
  }
  if (!input.recipientTimeZone) {
    throw new ConnectorError('conflict', 'A verified Twilio recipient timezone is required at execution.');
  }
  return {
    kind: 'message.send', messageId: input.messageId,
    contactId: input.contactId, contactPointId: input.contactPointId,
    to, body, consentEvidenceId: input.consentEvidenceId,
    consentVersion: input.consentVersion, useCase: input.useCase,
    policyVersion: String(input.policyVersion), recipientTimeZone: input.recipientTimeZone,
    quietHoursStart: input.quietHoursStart.slice(0, 5), quietHoursEnd: input.quietHoursEnd.slice(0, 5),
    idempotencyKey: job.idempotencyKey, approvedAt: input.approvedAt,
    reviewedAliasEpoch: (() => {
      const epoch = Number(row.reviewedAliasEpoch);
      if (!Number.isSafeInteger(epoch) || epoch < 0) throw new ConnectorError('conflict', 'reviewedAliasEpoch is invalid.');
      return epoch;
    })(),
  };
}

function persistenceError(error: { code?: string }): never {
  if (error.code === '42501') throw new ConnectorError('lease-lost', 'Twilio job lease is no longer active.');
  if (error.code === 'P0002') throw new ConnectorError('not-found', 'Twilio job authority is unavailable.');
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', 'Twilio provider evidence conflicts.');
  throw new Error('Failed to bind Twilio provider evidence: persistence failed.');
}

export function createSupabaseTwilioAuthorityLoader(input: {
  readonly reader: ReturnTypeOfTwilioReader;
  readonly client: SupabaseClient;
  readonly callbackBaseUrl: string;
  readonly callbackEndpointKey: string;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: TwilioFetch;
  readonly now?: () => Date;
}): TwilioJobAuthorityLoader {
  return {
    async load(job) {
      const encrypted = await input.reader.read(job);
      const resolver = input.resolver ?? createEnvironmentKekResolver();
      const provider = parseTwilioProviderAuthority(decryptConnectorSecret(encrypted.providerAuthorityEnvelope, {
        workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'twilio',
        secretType: 'twilio-provider-authority', recordVersion: encrypted.providerAuthorityVersion,
      }, resolver));
      const apiKeySecret = parseTwilioApiCredential(decryptConnectorSecret(encrypted.apiCredentialEnvelope, {
        workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'twilio',
        secretType: 'twilio-api-key-secret', recordVersion: encrypted.apiCredentialVersion,
      }, resolver));
      if (sha256Hex(provider.accountSid) !== encrypted.authority.accountSidHash
        || sha256Hex(provider.apiKeySid) !== encrypted.authority.apiKeySidHash
        || !encrypted.authority.messagingServiceSidHash
        || sha256Hex(provider.messagingServiceSid) !== encrypted.authority.messagingServiceSidHash) {
        throw new ConnectorError('forbidden', 'Twilio credential identity does not match the approved workspace authority.');
      }
      const clock = input.now ?? (() => new Date());
      const operation = encrypted.executionMode === 'lookup-only'
        ? {
            kind: 'message.lookup' as const,
            messageId: encrypted.approval.messageId,
            providerMessageSid: encrypted.providerMessageBinding!.providerMessageSid,
          }
        : (() => {
            if (!encrypted.payloadEnvelope || !encrypted.payloadKind || !encrypted.payloadVersion || !encrypted.payloadHash) {
              throw new ConnectorError('conflict', 'Twilio send payload authority is missing.');
            }
            const rawOperation = decryptConnectorSecret(encrypted.payloadEnvelope, {
              workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'twilio',
              secretType: encrypted.payloadKind, recordVersion: encrypted.payloadVersion,
            }, resolver);
            const parsed = parseOperation(rawOperation, job, {
              ...encrypted.approval, useCase: encrypted.authority.approvedUseCase,
              payloadHash: encrypted.payloadHash, connectionId: encrypted.connectionId,
            });
            if (!evaluateTextingQuietHours({
              startLocal: parsed.quietHoursStart, endLocal: parsed.quietHoursEnd,
              recipientTimeZone: parsed.recipientTimeZone, policyVersion: parsed.policyVersion,
            }, clock()).allowed) throw new ConnectorError('conflict', 'Twilio send entered quiet hours after approval.');
            return parsed;
          })();
      return {
        operation,
        client: new TwilioMessagingClient({
          ...provider, apiKeySecret, callbackBaseUrl: input.callbackBaseUrl,
          callbackEndpointKey: input.callbackEndpointKey,
        }, input.fetcher),
        async bind(result) {
          const { error } = await input.client.rpc('bind_twilio_provider_message', {
            target_job_id: job.id, target_worker_id: job.leaseOwner,
            target_fencing_token: job.fencingToken, target_provider_message_sid: result.messageSid,
            target_provider_status: result.status, target_provider_request_hash: result.operationHash,
            target_occurred_at: clock().toISOString(),
          });
          if (error) persistenceError(error);
        },
      };
    },
  };
}

export function twilioApprovedOperationHash(value: TwilioApprovedSendOperation): string {
  return stablePayloadHash(value);
}
