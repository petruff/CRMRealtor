import { describe, expect, it, vi } from 'vitest';
import type { ConnectorJob } from '../domain/connector';
import { stablePayloadHash } from '../domain/connector';
import { executeGoogleSyncJob } from './google-sync-service';
import { loadGoogleGmailPushConfiguration } from '../config/google-gmail-push';

const endpointKey = 'a'.repeat(43);
const pushUrl = `https://crm.example.com/api/connectors/google/gmail/push/${endpointKey}`;
const gmailPush = loadGoogleGmailPushConfiguration({
  GOOGLE_GMAIL_PUBSUB_TOPIC: 'projects/omnix-prod/topics/gmail-push',
  GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION: 'projects/omnix-prod/subscriptions/gmail-push',
  GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: 'gmail-push@omnix-prod.iam.gserviceaccount.com',
  GOOGLE_GMAIL_PUSH_ENDPOINT_KEY: endpointKey, GOOGLE_GMAIL_PUSH_EXTERNAL_URL: pushUrl,
  GOOGLE_GMAIL_PUSH_AUDIENCE: pushUrl,
});

const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 7) };
const job: ConnectorJob = {
  id: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222',
  intentId: '33333333-3333-4333-8333-333333333333', intentVersion: 1,
  provider: 'google', actionType: 'calendar.sync', payloadReference: 'payload-a',
  idempotencyKey: 'google-sync-a', correlationId: '44444444-4444-4444-8444-444444444444',
  state: 'executing', attemptCount: 1, maxAttempts: 5, scheduledAt: '2026-08-12T12:00:00Z',
  leaseOwner: '55555555-5555-4555-8555-555555555555', leaseExpiresAt: '2026-08-12T12:05:00Z',
  fencingToken: 1, createdAt: '2026-08-12T12:00:00Z', updatedAt: '2026-08-12T12:00:00Z',
};

function database(taskVersion = 2) {
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'bind_google_gmail_watch_resource' ? { watch: { resourceVersion: 1 } } : {},
    error: null,
  }));
  const from = vi.fn((table: string) => {
    const builder = {
      select: vi.fn(() => builder), eq: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data: table === 'tasks' ? { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          workspace_id: job.workspaceId, task_version: taskVersion } : null,
        error: null,
      })),
    };
    return builder;
  });
  return { rpc, from };
}

describe('Google bounded synchronization', () => {
  it('records a remote Calendar edit against the current Omnix task version before checkpointing', async () => {
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const resourceKey = stablePayloadHash({ workspaceId: job.workspaceId, taskId });
    const db = database();
    await executeGoogleSyncJob({
      job, database: db as never, resolver,
      now: () => new Date('2026-08-12T12:00:00Z'),
      authority: {
        connectionId: '66666666-6666-4666-8666-666666666666', connectionEmail: 'owner@example.com',
        calendarId: 'calendar-a',
        client: {
          probeProfile: vi.fn(), listGmailHistory: vi.fn(), getGmailMetadata: vi.fn(),
          listRecentGmailMetadataIds: vi.fn(), watchGmail: vi.fn(),
          listOmnixCalendarEvents: vi.fn(async () => ({ nextSyncToken: 'sync-2', events: [{
            id: 'event-a', status: 'confirmed', summary: 'Changed remotely', updated: '2026-08-12T11:59:00Z',
            start: { dateTime: '2026-08-12T14:00:00Z', timeZone: 'America/New_York' },
            end: { dateTime: '2026-08-12T14:30:00Z', timeZone: 'America/New_York' },
            extendedProperties: { private: { omnix: 'true', taskId, taskVersion: '1', resourceKey,
              contentHash: stablePayloadHash({ summary: 'Original', start: '2026-08-12T14:00:00.000Z',
                end: '2026-08-12T14:30:00.000Z', timeZone: 'America/New_York' }) } },
          }] })),
        },
      },
    });
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'record_google_calendar_task_conflict', expect.objectContaining({
      target_task_id: taskId, target_task_version: 2, target_reason: 'task-version-drift',
    }));
    expect(db.rpc).toHaveBeenLastCalledWith('commit_google_sync_checkpoint', expect.objectContaining({
      target_stream: 'google.calendar-events', target_has_more: false,
    }));
  });

  it('keeps Gmail bodies and subjects out while binding exact metadata and a durable cursor', async () => {
    const gmailJob = { ...job, actionType: 'gmail.sync-metadata' };
    const db = database();
    await executeGoogleSyncJob({
      job: gmailJob, database: db as never, resolver, gmailPush,
      now: () => new Date('2026-08-12T12:00:00Z'),
      authority: {
        connectionId: '66666666-6666-4666-8666-666666666666', connectionEmail: 'owner@example.com',
        client: {
          probeProfile: vi.fn(async () => ({ emailAddress: 'owner@example.com', historyId: '10' })),
          watchGmail: vi.fn(async () => ({ historyId: '10', expiresAt: '2026-08-13T12:00:00Z' })),
          listRecentGmailMetadataIds: vi.fn(async () => ['message-a']), listGmailHistory: vi.fn(),
          getGmailMetadata: vi.fn(async () => ({ messageId: 'message-a', threadId: 'thread-a',
            internalDate: '2026-08-12T11:00:00Z', labels: ['INBOX'], from: 'buyer@example.com',
            to: 'owner@example.com' })), listOmnixCalendarEvents: vi.fn(),
        },
      },
    });
    expect(db.rpc).toHaveBeenNthCalledWith(3, 'bind_google_gmail_metadata_resource', expect.objectContaining({
      target_direction: 'incoming', target_normalized_counterpart_email: 'buyer@example.com',
    }));
    expect(JSON.stringify(db.rpc.mock.calls)).not.toMatch(/subject|body/i);
    expect(db.rpc).toHaveBeenLastCalledWith('commit_google_sync_checkpoint', expect.objectContaining({
      target_stream: 'google.gmail-history', target_expected_cursor_version: null,
    }));
  });
});
