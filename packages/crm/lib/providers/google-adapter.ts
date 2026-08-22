import {
  ConnectorError,
  stablePayloadHash,
  type ConnectorAdapter,
  type ConnectorAdapterResult,
  type ConnectorJob,
} from '../domain/connector.ts';
import { revokeGoogleOAuthGrant, type GoogleWorkspaceClient } from './google-client.ts';
import type { ConnectorKekResolver } from '../security/connector-secret-envelope.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeGoogleSyncJob, type GoogleSyncAuthority } from '../application/google-sync-service.ts';
import type { GoogleGmailPushConfiguration } from '../config/google-gmail-push.ts';

export type GoogleApprovedOperation =
  | { readonly kind: 'gmail.send'; readonly rawMessageBase64Url: string; readonly clientMessageId: string;
      readonly normalizedRecipient: string; readonly contactId: string; readonly contactPointId: string;
      readonly aliasEpoch: number }
  | { readonly kind: 'gmail.sync-metadata' }
  | { readonly kind: 'calendar.create-omnix-calendar'; readonly name: string; readonly resourceKeyHash: string }
  | { readonly kind: 'calendar.sync' }
  | { readonly kind: 'calendar.upsert-omnix-event'; readonly taskId: string; readonly taskVersion: number;
      readonly resourceKey: string; readonly title: string; readonly startAt: string; readonly endAt: string;
      readonly timeZone: string; readonly eventId?: string }
  | { readonly kind: 'calendar.complete-omnix-event' | 'calendar.cancel-omnix-event'
      | 'calendar.delete-omnix-event'; readonly taskId: string; readonly taskVersion: number;
      readonly taskStatus: 'completed' | 'archived'; readonly resourceKey: string; readonly eventId: string };

export interface GoogleSyncJobAuthority extends GoogleSyncAuthority {
  readonly database: SupabaseClient;
  readonly resolver: ConnectorKekResolver;
  readonly gmailPush?: GoogleGmailPushConfiguration;
}

export interface GoogleJobAuthority {
  readonly operation: GoogleApprovedOperation;
  readonly client: Pick<GoogleWorkspaceClient, 'sendGmail' | 'findSentMessageByClientMessageId'
    | 'createOmnixCalendar' | 'upsertOmnixCalendarEvent' | 'getOmnixCalendarEvent'
    | 'deleteOmnixCalendarEvent'>;
  readonly bind: {
    gmail?(input: { messageId: string; threadId: string; operationHash: string }): Promise<void>;
    calendar?(input: { calendarId: string; resourceKeyHash: string; etagHash: string }): Promise<void>;
    task?(input: { taskId: string; taskVersion: number; eventId: string; resourceKeyHash: string;
      etagHash: string; providerUpdatedAt: string }): Promise<void>;
    taskLifecycle?(input: { taskId: string; taskVersion: number; eventId: string; resourceKeyHash: string;
      evidenceHash: string; providerUpdatedAt: string }): Promise<void>;
    gmailAmbiguity?(input: { markerHash: string }): Promise<void>;
  };
  readonly gmailReconciliation?: {
    readonly strategy: 'bounded-metadata-scan' | 'unavailable-no-resend';
    readonly markerHash: string;
    readonly maxScan: number;
    unresolved(input: { outcome: 'not-found' | 'ambiguous' | 'unavailable'; scanEvidenceHash: string }): Promise<void>;
  };
  readonly calendarId?: string;
  readonly sync?: GoogleSyncJobAuthority;
}

export interface GoogleJobAuthorityLoader {
  load(job: ConnectorJob): Promise<GoogleJobAuthority>;
}

function providerError(error: unknown): ConnectorAdapterResult {
  if (error instanceof ConnectorError) {
    if (error.code === 'forbidden') return { outcome: 'terminal-failure', errorCategory: 'authorization_revoked' };
    if (error.code === 'invalid-input' || error.code === 'conflict') {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
    if (error.code === 'configuration-required' || error.code === 'provider-disabled') {
      return { outcome: 'terminal-failure', errorCategory: 'configuration_required' };
    }
    if (error.code === 'provider-retryable') return { outcome: 'retryable-failure', errorCategory: 'rate_limited' };
  }
  return { outcome: 'unknown', errorCategory: 'network_outcome_unknown' };
}

export class GoogleConnectorAdapter implements ConnectorAdapter {
  readonly provider = 'google' as const;

  constructor(
    private readonly authority: GoogleJobAuthorityLoader,
    private readonly revokeGrant: typeof revokeGoogleOAuthGrant = revokeGoogleOAuthGrant,
  ) {}

  async execute(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.provider !== 'google' || ![
      'gmail.send', 'gmail.sync-metadata', 'calendar.create-omnix-calendar',
      'calendar.upsert-omnix-event', 'calendar.complete-omnix-event',
      'calendar.cancel-omnix-event', 'calendar.delete-omnix-event', 'calendar.sync',
    ].includes(job.actionType)) return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    try {
      const authority = await this.authority.load(job);
      if (job.actionType === 'gmail.sync-metadata' || job.actionType === 'calendar.sync') {
        if (!authority.sync) throw new ConnectorError('configuration-required', 'Google sync authority is unavailable.');
        const result = await executeGoogleSyncJob({
          job, authority: authority.sync, database: authority.sync.database,
          resolver: authority.sync.resolver,
          ...(authority.sync.gmailPush ? { gmailPush: authority.sync.gmailPush } : {}),
        });
        return { outcome: 'succeeded', ...result };
      }
      const operationHash = stablePayloadHash(authority.operation);
      if (authority.operation.kind === 'gmail.send') {
        try {
          const result = await authority.client.sendGmail({ rawMessageBase64Url: authority.operation.rawMessageBase64Url });
          await authority.bind.gmail?.({ ...result, operationHash });
          return { outcome: 'succeeded', providerReceiptId: result.messageId, providerStatus: 'message-accepted' };
        } catch (error) {
          const result = providerError(error);
          if (result.outcome === 'unknown') {
            await authority.bind.gmailAmbiguity?.({
              markerHash: stablePayloadHash({ clientMessageId: authority.operation.clientMessageId }),
            });
          }
          return result;
        }
      }
      if (authority.operation.kind === 'calendar.create-omnix-calendar') {
        const result = await authority.client.createOmnixCalendar(authority.operation.name);
        await authority.bind.calendar?.({
          calendarId: result.calendarId, resourceKeyHash: authority.operation.resourceKeyHash,
          etagHash: stablePayloadHash(result.etag ?? result.calendarId),
        });
        return { outcome: 'succeeded', providerReceiptId: authority.operation.resourceKeyHash, providerStatus: 'calendar-bound' };
      }
      if (authority.operation.kind !== 'calendar.upsert-omnix-event') {
        if (!['calendar.complete-omnix-event', 'calendar.cancel-omnix-event',
          'calendar.delete-omnix-event'].includes(authority.operation.kind) || !authority.calendarId) {
          throw new ConnectorError('invalid-input', 'Google operation is not a supported write.');
        }
        const lifecycle = authority.operation as Extract<GoogleApprovedOperation, {
          kind: 'calendar.complete-omnix-event' | 'calendar.cancel-omnix-event' | 'calendar.delete-omnix-event'
        }>;
        await authority.client.deleteOmnixCalendarEvent({
          calendarId: authority.calendarId, eventId: lifecycle.eventId,
        });
        const evidenceHash = stablePayloadHash({
          operationHash, lifecycle: lifecycle.kind, eventId: lifecycle.eventId,
        });
        await authority.bind.taskLifecycle?.({
          taskId: lifecycle.taskId, taskVersion: lifecycle.taskVersion,
          eventId: lifecycle.eventId, resourceKeyHash: lifecycle.resourceKey,
          evidenceHash, providerUpdatedAt: new Date().toISOString(),
        });
        return { outcome: 'succeeded', providerReceiptId: lifecycle.resourceKey,
          providerStatus: lifecycle.kind.replace('calendar.', '').replace('-omnix-event', '') };
      }
      if (!authority.calendarId) throw new ConnectorError('conflict', 'Omnix-created Google Calendar is required.');
      const result = await authority.client.upsertOmnixCalendarEvent({
        calendarId: authority.calendarId, ...(authority.operation.eventId ? { eventId: authority.operation.eventId } : {}),
        summary: authority.operation.title,
        start: { dateTime: authority.operation.startAt, timeZone: authority.operation.timeZone },
        end: { dateTime: authority.operation.endAt, timeZone: authority.operation.timeZone },
        omnix: {
          taskId: authority.operation.taskId, taskVersion: authority.operation.taskVersion,
          resourceKey: authority.operation.resourceKey,
          contentHash: stablePayloadHash({
            summary: authority.operation.title.trim(),
            start: new Date(authority.operation.startAt).toISOString(),
            end: new Date(authority.operation.endAt).toISOString(),
            timeZone: authority.operation.timeZone,
          }),
        },
      });
      await authority.bind.task?.({
        taskId: authority.operation.taskId, taskVersion: authority.operation.taskVersion,
        eventId: result.eventId, resourceKeyHash: authority.operation.resourceKey,
        etagHash: stablePayloadHash(result.etag ?? result.eventId),
        providerUpdatedAt: result.updatedAt ?? new Date().toISOString(),
      });
      return { outcome: 'succeeded', providerReceiptId: authority.operation.resourceKey, providerStatus: 'event-bound' };
    } catch (error) {
      return providerError(error);
    }
  }

  async reconcile(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.provider !== 'google' || !['gmail.send', 'calendar.upsert-omnix-event',
      'calendar.complete-omnix-event', 'calendar.cancel-omnix-event',
      'calendar.delete-omnix-event'].includes(job.actionType)) {
      return { outcome: 'terminal-failure', errorCategory: 'compliance_blocked' };
    }
    try {
      const authority = await this.authority.load(job);
      if (authority.operation.kind === 'gmail.send') {
        const reconciliation = authority.gmailReconciliation;
        if (!reconciliation || reconciliation.strategy === 'unavailable-no-resend') {
          await reconciliation?.unresolved({
            outcome: 'unavailable', scanEvidenceHash: stablePayloadHash({
              markerHash: reconciliation.markerHash, strategy: 'unavailable-no-resend',
            }),
          });
          return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
        }
        const metadata = await authority.client.findSentMessageByClientMessageId(
          authority.operation.clientMessageId, reconciliation.maxScan,
        );
        if (metadata) {
          await authority.bind.gmail?.({
            messageId: metadata.messageId, threadId: metadata.threadId,
            operationHash: stablePayloadHash(authority.operation),
          });
          return { outcome: 'succeeded', providerReceiptId: metadata.messageId, providerStatus: 'message-reconciled' };
        }
        await reconciliation.unresolved({
          outcome: 'not-found', scanEvidenceHash: stablePayloadHash({
            markerHash: reconciliation.markerHash, maxScan: reconciliation.maxScan, matched: false,
          }),
        });
        return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
      }
      if (!authority.operation.kind.startsWith('calendar.')
        || !('eventId' in authority.operation) || !authority.operation.eventId || !authority.calendarId) {
        return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
      }
      const event = await authority.client.getOmnixCalendarEvent({
        calendarId: authority.calendarId, eventId: authority.operation.eventId,
      });
      if (authority.operation.kind !== 'calendar.upsert-omnix-event') {
        if (event) return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
        const evidenceHash = stablePayloadHash({
          actionType: authority.operation.kind, eventId: authority.operation.eventId, absent: true,
        });
        await authority.bind.taskLifecycle?.({
          taskId: authority.operation.taskId, taskVersion: authority.operation.taskVersion,
          eventId: authority.operation.eventId, resourceKeyHash: authority.operation.resourceKey,
          evidenceHash, providerUpdatedAt: new Date().toISOString(),
        });
        return { outcome: 'succeeded', providerReceiptId: authority.operation.resourceKey,
          providerStatus: 'event-lifecycle-reconciled' };
      }
      if (!event) return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
      await authority.bind.task?.({
        taskId: authority.operation.taskId, taskVersion: authority.operation.taskVersion,
        eventId: event.eventId, resourceKeyHash: authority.operation.resourceKey,
        etagHash: stablePayloadHash(event.etag ?? event.eventId),
        providerUpdatedAt: event.updatedAt ?? new Date().toISOString(),
      });
      return { outcome: 'succeeded', providerReceiptId: authority.operation.resourceKey,
        providerStatus: 'event-reconciled' };
    } catch (error) {
      return providerError(error);
    }
  }

  async revoke(_connection: import('../domain/connector.ts').ConnectorConnection, token?: string) {
    if (!token) return { outcome: 'terminal-failure' as const, errorCategory: 'configuration_required' as const };
    try {
      await this.revokeGrant(token);
      return {
        outcome: 'succeeded' as const,
        providerReceiptId: stablePayloadHash({ provider: 'google', operation: 'grant-revoked' }),
        providerStatus: 'provider-confirmed',
      };
    } catch (error) {
      return providerError(error);
    }
  }
}
