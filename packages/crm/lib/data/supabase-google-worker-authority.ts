import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, type ConnectorJob } from '../domain/connector.ts';
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

function secret(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'),
  };
}

export interface GoogleEncryptedJobAuthority {
  readonly connectionId: string;
  readonly connectionLabel: string;
  readonly actionType: string;
  readonly payloadKind: string;
  readonly payloadSchemaVersion: string;
  readonly payloadEnvelope: ConnectorSecretEnvelope;
  readonly payloadVersion: number;
  readonly accessTokenEnvelope: ConnectorSecretEnvelope;
  readonly accessTokenVersion: number;
  readonly accessTokenExpiresAt?: string;
  readonly accessState: 'live' | 'refresh-required';
  readonly refreshTokenEnvelope?: ConnectorSecretEnvelope;
  readonly refreshTokenVersion?: number;
  readonly cursor?: {
    readonly stream: 'google.gmail-history' | 'google.calendar-events';
    readonly envelope: ConnectorSecretEnvelope;
    readonly version: number;
  };
  readonly calendar?: { readonly calendarId: string; readonly resourceKeyHash: string; readonly resourceVersion: number };
}

export function supabaseGoogleJobAuthorityReader(
  client: SupabaseClient,
  input: { readonly workerId: string; readonly now?: () => Date },
) {
  return {
    async read(job: ConnectorJob): Promise<GoogleEncryptedJobAuthority> {
      if (job.provider !== 'google' || job.state !== 'executing' || job.leaseOwner !== input.workerId) {
        throw new ConnectorError('lease-lost', 'Active Google job lease is required.');
      }
      const { data, error } = await client.rpc('read_google_job_authority', {
        target_job_id: job.id, target_worker_id: input.workerId,
        target_fencing_token: job.fencingToken,
        target_now: (input.now ?? (() => new Date()))().toISOString(),
      });
      if (error) {
        if (error.code === '42501') throw new ConnectorError('lease-lost', 'Google job lease is no longer active.');
        if (error.code === 'P0002') throw new ConnectorError('not-found', 'Google job authority is unavailable.');
        throw new Error('Failed to read Google job authority: persistence failed.');
      }
      const envelope = object(data, 'Google job authority is invalid.');
      const jobRow = object(envelope.job, 'Google job authority omitted job.');
      const payload = object(envelope.payloadEnvelope, 'Google job payload authority is invalid.');
      const access = object(envelope.accessEnvelope, 'Google access token authority is invalid.');
      const refresh = envelope.refreshEnvelope
        ? object(envelope.refreshEnvelope, 'Google refresh token authority is invalid.')
        : undefined;
      const cursor = envelope.cursorEnvelope
        ? object(envelope.cursorEnvelope, 'Google cursor authority is invalid.')
        : undefined;
      if (!['live', 'refresh-required'].includes(String(envelope.accessState))) {
        throw new ConnectorError('conflict', 'Google access-token state is invalid.');
      }
      if (jobRow.jobId !== job.id || jobRow.workspaceId !== job.workspaceId
        || payload.payloadRef !== job.payloadReference
        || jobRow.payloadHash !== payload.canonicalHash || jobRow.actionType !== job.actionType) {
        throw new ConnectorError('conflict', 'Google leased job authority is inconsistent.');
      }
      const connectionId = text(jobRow.connectionId, 'connectionId');
      const calendar = envelope.calendarResource ? object(envelope.calendarResource, 'Google calendar authority is invalid.') : undefined;
      return {
        connectionId, connectionLabel: text(object(envelope.connection, 'Google connection authority is invalid.').displayLabel,
          'connectionLabel'), actionType: text(jobRow.actionType, 'actionType'),
        payloadKind: text(payload.payloadKind, 'payloadKind'),
        payloadSchemaVersion: text(payload.schemaVersion, 'payloadSchemaVersion'),
        payloadEnvelope: secret(payload), payloadVersion: integer(payload.envelopeVersion, 'payloadVersion'),
        accessTokenEnvelope: secret(access), accessTokenVersion: integer(access.secretVersion, 'accessTokenVersion'),
        accessState: envelope.accessState as GoogleEncryptedJobAuthority['accessState'],
        ...(typeof access.expiresAt === 'string' ? { accessTokenExpiresAt: access.expiresAt } : {}),
        ...(refresh ? {
          refreshTokenEnvelope: secret(refresh),
          refreshTokenVersion: integer(refresh.secretVersion, 'refreshTokenVersion'),
        } : {}),
        ...(cursor ? {
          cursor: {
            stream: text(cursor.stream, 'cursorStream') as 'google.gmail-history' | 'google.calendar-events',
            envelope: secret(cursor), version: integer(cursor.cursorVersion, 'cursorVersion'),
          },
        } : {}),
        ...(calendar ? { calendar: {
          calendarId: text(calendar.calendarId, 'calendarId'),
          resourceKeyHash: text(calendar.resourceKeyHash, 'calendarResourceKey'),
          resourceVersion: integer(calendar.resourceVersion, 'calendarResourceVersion'),
        } } : {}),
      };
    },
  };
}
