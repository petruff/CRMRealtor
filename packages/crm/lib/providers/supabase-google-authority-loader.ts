import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, stablePayloadHash, type ConnectorJob } from '../domain/connector.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import {
  GoogleWorkspaceClient,
  loadGoogleOAuthConfiguration,
  refreshGoogleAccessToken,
  type GoogleFetch,
  type GoogleOAuthConfiguration,
} from './google-client.ts';
import type { GoogleApprovedOperation, GoogleJobAuthority, GoogleJobAuthorityLoader } from './google-adapter.ts';
import type { ReturnTypeOfGoogleReader } from './supabase-google-authority-loader.types.ts';
import { loadGoogleGmailPushConfiguration } from '../config/google-gmail-push.ts';

function object(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch { throw new ConnectorError('conflict', 'Google approved payload is invalid.'); }
}

function operation(value: string, actionType: string): GoogleApprovedOperation {
  const row = object(value);
  if (actionType === 'gmail.sync-metadata' || actionType === 'calendar.sync') {
    if (row.schemaVersion !== 'google-sync.v1' || row.actionType !== actionType) {
      throw new ConnectorError('conflict', 'Google sync payload is invalid.');
    }
    return { kind: actionType };
  }
  if (actionType === 'gmail.send') {
    if (row.schemaVersion !== 'google-gmail-send.v1' || typeof row.rawMessageBase64Url !== 'string'
      || typeof row.clientMessageId !== 'string' || typeof row.normalizedRecipient !== 'string'
      || typeof row.contactId !== 'string' || typeof row.contactPointId !== 'string'
      || !Number.isSafeInteger(row.aliasEpoch) || Number(row.aliasEpoch) < 0) {
      throw new ConnectorError('conflict', 'Google Gmail payload is outside its approved contract.');
    }
    return { kind: 'gmail.send', rawMessageBase64Url: row.rawMessageBase64Url,
      clientMessageId: row.clientMessageId, normalizedRecipient: row.normalizedRecipient,
      contactId: row.contactId, contactPointId: row.contactPointId, aliasEpoch: Number(row.aliasEpoch) };
  }
  if (actionType === 'calendar.create-omnix-calendar') {
    if (row.schemaVersion !== 'google-calendar-create.v1' || typeof row.name !== 'string'
      || typeof row.resourceKeyHash !== 'string') {
      throw new ConnectorError('conflict', 'Google Calendar creation payload is invalid.');
    }
    return { kind: 'calendar.create-omnix-calendar', name: row.name, resourceKeyHash: row.resourceKeyHash };
  }
  if (actionType === 'calendar.upsert-omnix-event') {
    const fields = ['taskId', 'resourceKey', 'title', 'startAt', 'endAt', 'timeZone'];
    if (row.schemaVersion !== 'google-calendar-task.v1' || !Number.isSafeInteger(row.taskVersion)
      || fields.some((field) => typeof row[field] !== 'string')) {
      throw new ConnectorError('conflict', 'Google task event payload is invalid.');
    }
    return {
      kind: 'calendar.upsert-omnix-event', taskId: String(row.taskId), taskVersion: Number(row.taskVersion),
      resourceKey: String(row.resourceKey), title: String(row.title), startAt: String(row.startAt),
      endAt: String(row.endAt), timeZone: String(row.timeZone),
      ...(typeof row.eventId === 'string' ? { eventId: row.eventId } : {}),
    };
  }
  if (['calendar.complete-omnix-event', 'calendar.cancel-omnix-event',
    'calendar.delete-omnix-event'].includes(actionType)) {
    const fields = ['taskId', 'taskStatus', 'resourceKey', 'eventId'];
    if (row.schemaVersion !== 'google-calendar-task-lifecycle.v1'
      || row.actionType !== actionType || !Number.isSafeInteger(row.taskVersion)
      || fields.some((field) => typeof row[field] !== 'string')) {
      throw new ConnectorError('conflict', 'Google task lifecycle payload is invalid.');
    }
    return {
      kind: actionType as 'calendar.complete-omnix-event' | 'calendar.cancel-omnix-event'
        | 'calendar.delete-omnix-event',
      taskId: String(row.taskId), taskVersion: Number(row.taskVersion),
      taskStatus: row.taskStatus as 'completed' | 'archived',
      resourceKey: String(row.resourceKey), eventId: String(row.eventId),
    };
  }
  throw new ConnectorError('conflict', 'Google job action is unsupported by the write adapter.');
}

function rpcError(message: string, error: { code?: string }): never {
  if (error.code === '42501') throw new ConnectorError('lease-lost', message);
  if (error.code === 'P0002') throw new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', message);
  throw new Error(`${message}: persistence failed.`);
}

function encryptedToken(envelope: ReturnType<typeof encryptConnectorSecret>, expiresAt: string) {
  return {
    ciphertext: envelope.ciphertext, nonce: envelope.iv, authTag: envelope.tag,
    wrappedDek: envelope.encryptedDek, wrapNonce: envelope.encryptedDekIv,
    wrapAuthTag: envelope.encryptedDekTag, kekVersion: envelope.kekVersion,
    aadHash: envelope.aadHash, expiresAt,
  };
}

export function createSupabaseGoogleAuthorityLoader(input: {
  readonly reader: ReturnTypeOfGoogleReader;
  readonly client: SupabaseClient;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: GoogleFetch;
  readonly oauthConfiguration?: GoogleOAuthConfiguration;
  readonly environment?: Record<string, string | undefined>;
}): GoogleJobAuthorityLoader {
  return {
    async load(job: ConnectorJob) {
      const encrypted = await input.reader.read(job);
      const resolver = input.resolver ?? createEnvironmentKekResolver();
      const value = decryptConnectorSecret(encrypted.payloadEnvelope, {
        workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'google',
        secretType: encrypted.payloadKind, recordVersion: encrypted.payloadVersion,
      }, resolver);
      const parsed = operation(value, job.actionType);
      let accessToken = decryptConnectorSecret(encrypted.accessTokenEnvelope, {
        workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'google',
        secretType: 'google-access-token', recordVersion: encrypted.accessTokenVersion,
      }, resolver);
      if (encrypted.accessState === 'refresh-required') {
        if (!encrypted.refreshTokenEnvelope || !encrypted.refreshTokenVersion) {
          throw new ConnectorError('not-found', 'Google refresh authority is unavailable.');
        }
        const refreshToken = decryptConnectorSecret(encrypted.refreshTokenEnvelope, {
          workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'google',
          secretType: 'google-refresh-token', recordVersion: encrypted.refreshTokenVersion,
        }, resolver);
        const refreshed = await refreshGoogleAccessToken({
          configuration: input.oauthConfiguration ?? loadGoogleOAuthConfiguration(),
          refreshToken, ...(input.fetcher ? { fetcher: input.fetcher } : {}),
        });
        if (refreshed.grantedScopes
          && !refreshed.grantedScopes.includes(encrypted.actionType === 'gmail.send'
            ? 'https://www.googleapis.com/auth/gmail.send'
            : encrypted.actionType === 'gmail.sync-metadata'
              ? 'https://www.googleapis.com/auth/gmail.metadata'
              : 'https://www.googleapis.com/auth/calendar.app.created')) {
          throw new ConnectorError('forbidden', 'Google refreshed token lost the approved capability scope.');
        }
        const nextVersion = encrypted.accessTokenVersion + 1;
        const expiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1_000).toISOString();
        const nextEnvelope = encryptConnectorSecret(refreshed.accessToken, {
          workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'google',
          secretType: 'google-access-token', recordVersion: nextVersion,
        }, resolver);
        const { error } = await input.client.rpc('refresh_google_job_access_token', {
          target_job_id: job.id, target_worker_id: job.leaseOwner,
          target_fencing_token: job.fencingToken,
          target_expected_access_secret_version: encrypted.accessTokenVersion,
          target_access_envelope: encryptedToken(nextEnvelope, expiresAt),
          target_occurred_at: new Date().toISOString(),
        });
        if (error) rpcError('Failed to persist refreshed Google access token', error);
        accessToken = refreshed.accessToken;
      }
      const common = {
        target_job_id: job.id, target_worker_id: job.leaseOwner,
        target_fencing_token: job.fencingToken, target_occurred_at: new Date().toISOString(),
      };
      let gmailReconciliation: GoogleJobAuthority['gmailReconciliation'];
      if (job.actionType === 'gmail.send' && job.state === 'reconciliation-required') {
        const { data, error } = await input.client.rpc('read_google_gmail_send_reconciliation_state', {
          target_job_id: job.id, target_worker_id: job.leaseOwner,
          target_fencing_token: job.fencingToken, target_now: new Date().toISOString(),
        });
        if (error) rpcError('Failed to read Google Gmail reconciliation authority', error);
        const envelope = data as Record<string, unknown>;
        const row = envelope?.reconciliation as Record<string, unknown> | undefined;
        if (!row || !['bounded-metadata-scan', 'unavailable-no-resend'].includes(String(row.strategy))
          || typeof row.markerHash !== 'string' || !Number.isInteger(row.maxScan)
          || Number(row.maxScan) < 1 || Number(row.maxScan) > 100) {
          throw new ConnectorError('conflict', 'Google Gmail reconciliation authority is invalid.');
        }
        gmailReconciliation = {
          strategy: row.strategy as 'bounded-metadata-scan' | 'unavailable-no-resend',
          markerHash: row.markerHash, maxScan: Number(row.maxScan),
          async unresolved(result) {
            const { error: unresolvedError } = await input.client.rpc(
              'record_google_gmail_send_reconciliation_unresolved', {
                target_job_id: job.id, target_worker_id: job.leaseOwner,
                target_fencing_token: job.fencingToken, target_marker_hash: row.markerHash,
                target_scan_evidence_hash: result.scanEvidenceHash, target_outcome: result.outcome,
                target_occurred_at: new Date().toISOString(),
              },
            );
            if (unresolvedError) rpcError('Failed to persist Google Gmail reconciliation outcome', unresolvedError);
          },
        };
      }
      return {
        operation: parsed, client: new GoogleWorkspaceClient(accessToken, input.fetcher),
        ...(gmailReconciliation ? { gmailReconciliation } : {}),
        ...(encrypted.calendar ? { calendarId: encrypted.calendar.calendarId } : {}),
        ...(['gmail.sync-metadata', 'calendar.sync'].includes(job.actionType) ? { sync: {
          client: new GoogleWorkspaceClient(accessToken, input.fetcher),
          connectionEmail: encrypted.connectionLabel,
          connectionId: encrypted.connectionId,
          ...(encrypted.calendar ? { calendarId: encrypted.calendar.calendarId } : {}),
          ...(encrypted.cursor ? {
            cursor: {
              stream: encrypted.cursor.stream,
              value: decryptConnectorSecret(encrypted.cursor.envelope, {
                workspaceId: job.workspaceId, connectionId: encrypted.connectionId, provider: 'google',
                secretType: encrypted.cursor.stream, recordVersion: encrypted.cursor.version,
              }, resolver),
              version: encrypted.cursor.version,
            },
          } : {}),
          database: input.client, resolver,
          ...(job.actionType === 'gmail.sync-metadata'
            ? { gmailPush: loadGoogleGmailPushConfiguration(input.environment ?? process.env) } : {}),
        } } : {}),
        bind: {
          async gmail(result) {
            const { error } = await input.client.rpc('bind_google_gmail_send_resource', {
              ...common, target_message_id: result.messageId, target_thread_id: result.threadId,
              target_operation_hash: result.operationHash,
            });
            if (error) rpcError('Failed to bind Google Gmail send evidence', error);
          },
          async gmailAmbiguity(result) {
            const { error } = await input.client.rpc('record_google_gmail_send_ambiguity', {
              ...common, target_operation_marker_hash: result.markerHash,
            });
            if (error) rpcError('Failed to persist Google Gmail send ambiguity', error);
          },
          async calendar(result) {
            const { error } = await input.client.rpc('bind_google_calendar_resource', {
              ...common, target_provider_calendar_id: result.calendarId,
              target_resource_key_hash: result.resourceKeyHash, target_etag_hash: result.etagHash,
            });
            if (error) rpcError('Failed to bind Google Calendar evidence', error);
          },
          async task(result) {
            const { error } = await input.client.rpc('bind_google_task_event_resource', {
              ...common, target_task_id: result.taskId, target_task_version: result.taskVersion,
              target_provider_event_id: result.eventId, target_resource_key_hash: result.resourceKeyHash,
              target_etag_hash: result.etagHash, target_provider_updated_at: result.providerUpdatedAt,
            });
            if (error) rpcError('Failed to bind Google task event evidence', error);
          },
          async taskLifecycle(result) {
            const { error } = await input.client.rpc('bind_google_task_event_lifecycle', {
              ...common, target_task_id: result.taskId, target_task_version: result.taskVersion,
              target_event_id: result.eventId, target_resource_hash: result.resourceKeyHash,
              target_etag_or_evidence_hash: result.evidenceHash,
              target_provider_updated_at: result.providerUpdatedAt,
            });
            if (error) rpcError('Failed to bind Google task lifecycle evidence', error);
          },
        },
      };
    },
  };
}

export function googleOperationHash(operation: GoogleApprovedOperation): string {
  return stablePayloadHash(operation);
}
