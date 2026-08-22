import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, stablePayloadHash, type ConnectorJob } from '../domain/connector.ts';
import { normalizeSingleGoogleMailbox } from '../domain/google-connector.ts';
import type { ConnectorKekResolver } from '../security/connector-secret-envelope.ts';
import { encryptConnectorSecret } from '../security/connector-secret-envelope.ts';
import { GoogleCursorExpiredError, type GoogleWorkspaceClient } from '../providers/google-client.ts';
import type { GoogleGmailPushConfiguration } from '../config/google-gmail-push.ts';

export interface GoogleSyncAuthority {
  readonly client: Pick<GoogleWorkspaceClient, 'probeProfile' | 'listGmailHistory' | 'getGmailMetadata'
    | 'listRecentGmailMetadataIds' | 'listOmnixCalendarEvents' | 'watchGmail'>;
  readonly connectionEmail: string;
  readonly connectionId: string;
  readonly calendarId?: string;
  readonly cursor?: { readonly stream: 'google.gmail-history' | 'google.calendar-events'; readonly value: string;
    readonly version: number };
}

function rpcError(message: string, error: { code?: string }): never {
  if (error.code === '42501') throw new ConnectorError('lease-lost', message);
  if (error.code === 'P0002') throw new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', message);
  throw new Error(`${message}: persistence failed.`);
}

function mailboxKind(value: string): 'single' | 'self-only' | 'group-address' {
  return value.includes(',') || value.includes(';') || /:\s*.*;/.test(value) ? 'group-address' : 'single';
}

export function normalizedGoogleCounterpart(input: { from: string; to: string; self: string }) {
  const fromKind = mailboxKind(input.from);
  const toKind = mailboxKind(input.to);
  if (fromKind === 'group-address' || toKind === 'group-address') {
    return { direction: 'incoming' as const, counterpartKind: 'group-address' as const, email: input.self };
  }
  const from = normalizeSingleGoogleMailbox(input.from);
  const to = normalizeSingleGoogleMailbox(input.to);
  const self = normalizeSingleGoogleMailbox(input.self);
  if (from === self && to === self) return { direction: 'outgoing' as const, counterpartKind: 'self-only' as const, email: self };
  return from === self
    ? { direction: 'outgoing' as const, counterpartKind: 'single' as const, email: to }
    : { direction: 'incoming' as const, counterpartKind: 'single' as const, email: from };
}

export function encryptedGoogleCursor(value: string, input: {
  workspaceId: string; connectionId: string; stream: string; version: number; resolver: ConnectorKekResolver;
}) {
  const envelope = encryptConnectorSecret(value, {
    workspaceId: input.workspaceId, connectionId: input.connectionId, provider: 'google',
    secretType: input.stream, recordVersion: input.version,
  }, input.resolver);
  return {
    ciphertext: envelope.ciphertext, nonce: envelope.iv, authTag: envelope.tag,
    wrappedDek: envelope.encryptedDek, wrapNonce: envelope.encryptedDekIv,
    wrapAuthTag: envelope.encryptedDekTag, kekVersion: envelope.kekVersion,
    aadHash: envelope.aadHash, expiresAt: null,
  };
}

function calendarObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function calendarInstant(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : undefined;
}

interface OmnixCalendarProjection {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly resourceKey: string;
  readonly providerUpdatedAt: string;
  readonly reason?: 'remote-edited' | 'remote-deleted';
}

function omnixCalendarProjection(event: Record<string, unknown>): OmnixCalendarProjection | undefined {
  const extended = calendarObject(event.extendedProperties);
  const privateProperties = calendarObject(extended?.private);
  if (privateProperties?.omnix !== 'true') return undefined;
  const taskId = privateProperties.taskId;
  const taskVersion = Number(privateProperties.taskVersion);
  const resourceKey = privateProperties.resourceKey;
  const contentHash = privateProperties.contentHash;
  const providerUpdatedAt = calendarInstant(event.updated);
  if (typeof taskId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)
    || !Number.isSafeInteger(taskVersion) || taskVersion < 1
    || typeof resourceKey !== 'string' || !/^[0-9a-f]{64}$/.test(resourceKey)
    || typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)
    || !providerUpdatedAt) return undefined;
  if (event.status === 'cancelled') {
    return { taskId, taskVersion, resourceKey, providerUpdatedAt, reason: 'remote-deleted' };
  }
  const start = calendarObject(event.start);
  const end = calendarObject(event.end);
  const startAt = calendarInstant(start?.dateTime);
  const endAt = calendarInstant(end?.dateTime);
  const timeZone = typeof start?.timeZone === 'string' ? start.timeZone : undefined;
  const currentHash = typeof event.summary === 'string' && startAt && endAt && timeZone
    ? stablePayloadHash({ summary: event.summary.trim(), start: startAt, end: endAt, timeZone })
    : undefined;
  return {
    taskId, taskVersion, resourceKey, providerUpdatedAt,
    ...(currentHash === contentHash ? {} : { reason: 'remote-edited' as const }),
  };
}

async function recordCalendarConflicts(input: {
  readonly database: SupabaseClient;
  readonly job: ConnectorJob;
  readonly connectionId: string;
  readonly common: Record<string, unknown>;
  readonly events: readonly Record<string, unknown>[];
}) {
  const projections = new Map<string, OmnixCalendarProjection>();
  for (const event of input.events) {
    const projection = omnixCalendarProjection(event);
    if (!projection) continue;
    const expectedKey = stablePayloadHash({ workspaceId: input.job.workspaceId, taskId: projection.taskId });
    if (expectedKey !== projection.resourceKey) continue;
    const existing = projections.get(projection.taskId);
    if (!existing || projection.providerUpdatedAt >= existing.providerUpdatedAt) {
      projections.set(projection.taskId, projection);
    }
  }
  for (const projection of projections.values()) {
    if (!projection.reason) continue;
    const { data: task, error: taskError } = await input.database.from('tasks')
      .select('id, workspace_id, task_version')
      .eq('workspace_id', input.job.workspaceId).eq('id', projection.taskId).maybeSingle();
    if (taskError) rpcError('Failed to validate Omnix task authority', taskError);
    if (!task) continue;
    const row = task as { id: string; workspace_id: string; task_version: number };
    const taskVersion = Number(row.task_version);
    const reason = taskVersion === projection.taskVersion ? projection.reason : 'task-version-drift';
    const { data: known, error: stateError } = await input.database.from('google_calendar_task_states')
      .select('task_id, task_version, state, last_error_category')
      .eq('workspace_id', input.job.workspaceId).eq('connection_id', input.connectionId)
      .eq('task_id', projection.taskId).maybeSingle();
    if (stateError) rpcError('Failed to validate Google task state', stateError);
    const knownRow = known as { task_version?: number; state?: string; last_error_category?: string } | null;
    if (Number(knownRow?.task_version) === taskVersion
      && knownRow?.last_error_category === reason.replaceAll('-', '_')) continue;
    const { error } = await input.database.rpc('record_google_calendar_task_conflict', {
      ...input.common, target_task_id: projection.taskId, target_task_version: taskVersion,
      target_resource_key_hash: projection.resourceKey, target_reason: reason,
      target_provider_updated_at: projection.providerUpdatedAt,
    });
    if (error) rpcError('Failed to record Google Calendar task conflict', error);
  }
}

export async function executeGoogleSyncJob(input: {
  readonly job: ConnectorJob;
  readonly authority: GoogleSyncAuthority;
  readonly database: SupabaseClient;
  readonly resolver: ConnectorKekResolver;
  readonly gmailPush?: GoogleGmailPushConfiguration;
  readonly now?: () => Date;
}): Promise<{ readonly providerReceiptId: string; readonly providerStatus: string }> {
  const now = input.now ?? (() => new Date());
  const common = {
    target_job_id: input.job.id, target_worker_id: input.job.leaseOwner,
    target_fencing_token: input.job.fencingToken, target_occurred_at: now().toISOString(),
  };
  try {
    if (input.job.actionType === 'gmail.sync-metadata') {
      const profile = await input.authority.client.probeProfile();
      if (!input.gmailPush) {
        throw new ConnectorError('configuration-required', 'Verified Gmail Push configuration is required.');
      }
      const watch = await input.authority.client.watchGmail({ topicName: input.gmailPush.topicName });
      const { data: boundWatch, error: watchError } = await input.database.rpc('bind_google_gmail_watch_resource', {
        ...common, target_channel_key_hash: stablePayloadHash({ subscription: input.gmailPush.subscriptionName }),
        target_resource_key_hash: stablePayloadHash({ historyId: watch.historyId, expiresAt: watch.expiresAt }),
        target_expires_at: watch.expiresAt,
      });
      if (watchError) rpcError('Failed to bind Gmail watch resource', watchError);
      const resourceVersion = Number((boundWatch as { watch?: { resourceVersion?: number } } | null)?.watch?.resourceVersion);
      if (!Number.isSafeInteger(resourceVersion) || resourceVersion < 1) {
        throw new ConnectorError('conflict', 'Gmail watch resource version is invalid.');
      }
      const { error: ingressError } = await input.database.rpc('bind_google_gmail_watch_ingress_authority', {
        ...common, target_expected_version: null,
        target_endpoint_key_hash: input.gmailPush.endpointKeyHash,
        target_exact_external_url_hash: input.gmailPush.exactExternalUrlHash,
        target_subscription_hash: input.gmailPush.subscriptionHash,
        target_oidc_audience_hash: input.gmailPush.oidcAudienceHash,
        target_account_email_hash: stablePayloadHash(input.authority.connectionEmail.trim().toLowerCase()),
        target_correlation_id: input.job.correlationId,
      });
      if (ingressError) rpcError('Failed to bind Gmail push ingress authority', ingressError);
      let messageIds: readonly string[];
      let checkpointHistoryId = profile.historyId;
      let nextPageToken: string | undefined;
      if (input.authority.cursor?.value) {
        const cursor = JSON.parse(input.authority.cursor.value) as {
          startHistoryId?: string; historyId?: string; pageToken?: string | null;
        };
        const startHistoryId = cursor.startHistoryId ?? cursor.historyId;
        if (!startHistoryId) throw new ConnectorError('conflict', 'Gmail cursor authority is invalid.');
        const history = await input.authority.client.listGmailHistory({
          startHistoryId, maxResults: 500,
          ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
        });
        messageIds = history.messageIds;
        checkpointHistoryId = history.historyId;
        nextPageToken = history.nextPageToken;
      } else {
        messageIds = await input.authority.client.listRecentGmailMetadataIds(100);
      }
      let lastEventAt: string | undefined;
      for (const messageId of messageIds.slice(0, 500)) {
        const metadata = await input.authority.client.getGmailMetadata(messageId);
        const counterpart = normalizedGoogleCounterpart({
          from: metadata.from, to: metadata.to, self: input.authority.connectionEmail,
        });
        const resourceHash = stablePayloadHash({
          connectionId: input.authority.connectionId, messageId: metadata.messageId,
          threadId: metadata.threadId, internalDate: metadata.internalDate,
          direction: counterpart.direction, counterpart: counterpart.email, labels: metadata.labels,
        });
        const { error } = await input.database.rpc('bind_google_gmail_metadata_resource', {
          ...common, target_message_id: metadata.messageId, target_thread_id: metadata.threadId,
          target_direction: counterpart.direction, target_normalized_counterpart_email: counterpart.email,
          target_counterpart_kind: counterpart.counterpartKind, target_labels: [...metadata.labels],
          target_provider_occurred_at: metadata.internalDate, target_resource_hash: resourceHash,
        });
        if (error) rpcError('Failed to bind Gmail metadata', error);
        lastEventAt = metadata.internalDate;
      }
      const cursorVersion = (input.authority.cursor?.version ?? 0) + 1;
      const cursorValue = JSON.stringify({
        historyId: checkpointHistoryId,
        startHistoryId: nextPageToken
          ? (input.authority.cursor?.value
            ? (JSON.parse(input.authority.cursor.value) as { startHistoryId?: string; historyId?: string }).startHistoryId
              ?? (JSON.parse(input.authority.cursor.value) as { historyId?: string }).historyId
            : profile.historyId)
          : checkpointHistoryId,
        pageToken: nextPageToken ?? null,
      });
      const checkpointHash = stablePayloadHash({ historyId: checkpointHistoryId, pageToken: nextPageToken ?? null });
      const { error } = await input.database.rpc('commit_google_sync_checkpoint', {
        ...common, target_stream: 'google.gmail-history',
        target_expected_cursor_version: input.authority.cursor?.version ?? null,
        target_cursor_envelope: encryptedGoogleCursor(cursorValue, {
          workspaceId: input.job.workspaceId, connectionId: input.authority.connectionId,
          stream: 'google.gmail-history', version: cursorVersion, resolver: input.resolver,
        }),
        target_provider_checkpoint_hash: checkpointHash,
        target_has_more: Boolean(nextPageToken), target_last_provider_event_at: lastEventAt ?? null,
      });
      if (error) rpcError('Failed to commit Gmail cursor', error);
      return { providerReceiptId: checkpointHash, providerStatus: nextPageToken ? 'page-applied' : 'sync-current' };
    }
    if (input.job.actionType === 'calendar.sync') {
      if (!input.authority.calendarId) throw new ConnectorError('conflict', 'Omnix Calendar authority is required.');
      const cursor = input.authority.cursor?.value ? JSON.parse(input.authority.cursor.value) as { syncToken?: string; pageToken?: string } : {};
      const page = await input.authority.client.listOmnixCalendarEvents({
        calendarId: input.authority.calendarId, maxResults: 500,
        ...(cursor.syncToken ? { syncToken: cursor.syncToken } : {}),
        ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
        ...(!cursor.syncToken && !cursor.pageToken ? { timeMin: new Date(now().getTime() - 90 * 86_400_000).toISOString() } : {}),
      });
      await recordCalendarConflicts({ database: input.database, job: input.job,
        connectionId: input.authority.connectionId, common, events: page.events });
      const cursorValue = JSON.stringify({ syncToken: page.nextSyncToken ?? cursor.syncToken ?? null,
        pageToken: page.nextPageToken ?? null });
      const checkpointHash = stablePayloadHash({ cursorValue, eventCount: page.events.length });
      const { error } = await input.database.rpc('commit_google_sync_checkpoint', {
        ...common, target_stream: 'google.calendar-events',
        target_expected_cursor_version: input.authority.cursor?.version ?? null,
        target_cursor_envelope: encryptedGoogleCursor(cursorValue, {
          workspaceId: input.job.workspaceId, connectionId: input.authority.connectionId,
          stream: 'google.calendar-events', version: (input.authority.cursor?.version ?? 0) + 1,
          resolver: input.resolver,
        }),
        target_provider_checkpoint_hash: checkpointHash,
        target_has_more: Boolean(page.nextPageToken), target_last_provider_event_at: now().toISOString(),
      });
      if (error) rpcError('Failed to commit Calendar cursor', error);
      return { providerReceiptId: checkpointHash, providerStatus: page.nextPageToken ? 'page-applied' : 'sync-current' };
    }
    throw new ConnectorError('invalid-input', 'Google sync action is unsupported.');
  } catch (error) {
    if (error instanceof GoogleCursorExpiredError) {
      const stream = error.stream === 'gmail-history' ? 'google.gmail-history' : 'google.calendar-events';
      const { error: persistence } = await input.database.rpc('mark_google_sync_cursor_expired', {
        ...common, target_stream: stream,
        target_expected_cursor_version: input.authority.cursor?.version ?? null,
        target_error_category: error.stream === 'gmail-history'
          ? 'gmail_history_expired' : 'calendar_sync_token_expired',
      });
      if (persistence) rpcError('Failed to mark Google cursor expired', persistence);
      throw new ConnectorError('provider-retryable', 'Google cursor expired; bounded full resync is required.');
    }
    throw error;
  }
}
