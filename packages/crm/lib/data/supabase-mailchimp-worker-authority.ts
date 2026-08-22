import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, type ConnectorJob } from '../domain/connector.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

export interface MailchimpJobBinding {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly dataCenter: string;
  readonly audienceId: string;
  readonly accountIdHash: string;
  readonly mappingVersion: number;
  readonly baselineRequired: boolean;
  readonly webhookRegistrationRequired: boolean;
}

export interface MailchimpEncryptedJobAuthority {
  readonly binding: MailchimpJobBinding;
  readonly operationEnvelope: ConnectorSecretEnvelope;
  readonly operationVersion: number;
  readonly accessTokenEnvelope: ConnectorSecretEnvelope;
  readonly accessTokenVersion: number;
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
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConnectorError('conflict', `${field} is invalid.`);
  return parsed;
}

function secretEnvelope(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    kekVersion: text(row.kekVersion, 'kekVersion'), aadHash: text(row.aadHash, 'aadHash'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), ciphertext: text(row.ciphertext, 'ciphertext'),
    iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
  };
}

function byteObject(value: unknown, message: string): Record<string, unknown> {
  return record(value, message);
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('lease-lost', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  return new Error(`${message}: persistence failed.`);
}

export interface SupabaseMailchimpJobAuthorityReader {
  read(job: ConnectorJob): Promise<MailchimpEncryptedJobAuthority>;
}

export function supabaseMailchimpJobAuthorityReader(
  supabase: SupabaseClient,
  input: { readonly workerId: string; readonly now?: () => Date },
): SupabaseMailchimpJobAuthorityReader {
  return {
    async read(job) {
      if (job.provider !== 'mailchimp' || job.state !== 'executing' || job.leaseOwner !== input.workerId) {
        throw new ConnectorError('lease-lost', 'Active Mailchimp job lease is required.');
      }
      const target_now = (input.now ?? (() => new Date()))().toISOString();
      const common = {
        target_job_id: job.id, target_worker_id: input.workerId,
        target_fencing_token: job.fencingToken, target_now,
      };
      const [bindingResult, payloadResult, secretResult] = await Promise.all([
        supabase.rpc('read_mailchimp_job_binding', common),
        supabase.rpc('read_connector_job_payload_envelope', common),
        supabase.rpc('read_connector_job_secret_envelope', {
          ...common, target_secret_type: 'mailchimp-access-token',
        }),
      ]);
      if (bindingResult.error) throw persistenceError('Failed to read Mailchimp binding', bindingResult.error);
      if (payloadResult.error) throw persistenceError('Failed to read Mailchimp operation', payloadResult.error);
      if (secretResult.error) throw persistenceError('Failed to read Mailchimp access token', secretResult.error);
      const bindingRow = record(bindingResult.data, 'Mailchimp binding is invalid.');
      const payloadRow = byteObject(payloadResult.data, 'Mailchimp payload envelope is invalid.');
      const secretRow = byteObject(secretResult.data, 'Mailchimp secret envelope is invalid.');
      const binding: MailchimpJobBinding = {
        connectionId: text(bindingRow.connectionId, 'connectionId'),
        workspaceId: typeof bindingRow.workspaceId === 'string' && bindingRow.workspaceId
          ? bindingRow.workspaceId : job.workspaceId,
        dataCenter: text(bindingRow.dataCenter, 'dataCenter'),
        audienceId: text(bindingRow.audienceId, 'audienceId'),
        accountIdHash: text(bindingRow.accountIdHash, 'accountIdHash'),
        mappingVersion: integer(bindingRow.mappingVersion, 'mappingVersion'),
        baselineRequired: bindingRow.baselineRequired === true,
        webhookRegistrationRequired: bindingRow.webhookRegistrationRequired === true,
      };
      if (binding.workspaceId !== job.workspaceId) {
        throw new ConnectorError('conflict', 'Mailchimp binding workspace does not match the leased job.');
      }
      if (binding.baselineRequired || binding.webhookRegistrationRequired) {
        throw new ConnectorError('conflict', 'Mailchimp audience baseline and signed webhook proof are required.');
      }
      const payloadVersion = integer(payloadRow.envelopeVersion, 'envelopeVersion');
      const tokenVersion = integer(secretRow.secretVersion, 'secretVersion');
      return {
        binding,
        operationEnvelope: secretEnvelope(payloadRow),
        operationVersion: payloadVersion,
        accessTokenEnvelope: secretEnvelope(secretRow),
        accessTokenVersion: tokenVersion,
      };
    },
  };
}
