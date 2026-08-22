import { describe, expect, it, vi } from 'vitest';
import type { ConnectorJob } from '../domain/connector';
import { GoogleConnectorAdapter } from './google-adapter';

const job: ConnectorJob = {
  id: 'job-a', workspaceId: 'workspace-a', intentId: 'intent-a', intentVersion: 1,
  provider: 'google', actionType: 'gmail.send', payloadReference: 'payload-a',
  idempotencyKey: 'key-a', correlationId: 'correlation-a', state: 'executing', attemptCount: 1,
  maxAttempts: 5, scheduledAt: '2026-08-12T12:00:00Z', leaseOwner: 'worker-a',
  leaseExpiresAt: '2026-08-12T12:02:00Z', fencingToken: 1,
  createdAt: '2026-08-12T12:00:00Z', updatedAt: '2026-08-12T12:00:00Z',
};

describe('Google governed connector adapter', () => {
  it('sends the exact approved Gmail payload and binds provider evidence', async () => {
    const sendGmail = vi.fn(async () => ({ messageId: 'message-a', threadId: 'thread-a' }));
    const gmail = vi.fn(async () => undefined);
    const adapter = new GoogleConnectorAdapter({ load: async () => ({
      operation: { kind: 'gmail.send', rawMessageBase64Url: 'cmF3', clientMessageId: 'key@omnix.local',
        normalizedRecipient: 'buyer@example.com', contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 4 },
      client: { sendGmail, findSentMessageByClientMessageId: vi.fn(),
        createOmnixCalendar: vi.fn(), upsertOmnixCalendarEvent: vi.fn(), getOmnixCalendarEvent: vi.fn(),
        deleteOmnixCalendarEvent: vi.fn() }, bind: { gmail },
    }) });
    await expect(adapter.execute(job)).resolves.toEqual({
      outcome: 'succeeded', providerReceiptId: 'message-a', providerStatus: 'message-accepted',
    });
    expect(sendGmail).toHaveBeenCalledOnce();
    expect(gmail).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'message-a' }));
  });

  it('reconciles by the bounded Message-ID projection and never sends again', async () => {
    const sendGmail = vi.fn();
    const gmail = vi.fn(async () => undefined);
    const adapter = new GoogleConnectorAdapter({ load: async () => ({
      operation: { kind: 'gmail.send', rawMessageBase64Url: 'cmF3', clientMessageId: 'key@omnix.local',
        normalizedRecipient: 'buyer@example.com', contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 4 },
      client: { sendGmail, findSentMessageByClientMessageId: vi.fn(async () => ({
          messageId: 'message-a', threadId: 'thread-a',
        })),
        createOmnixCalendar: vi.fn(), upsertOmnixCalendarEvent: vi.fn(), getOmnixCalendarEvent: vi.fn(),
        deleteOmnixCalendarEvent: vi.fn() }, bind: { gmail },
      gmailReconciliation: {
        strategy: 'bounded-metadata-scan', markerHash: 'a'.repeat(64), maxScan: 100,
        unresolved: vi.fn(async () => undefined),
      },
    }) });
    await expect(adapter.reconcile(job)).resolves.toEqual({
      outcome: 'succeeded', providerReceiptId: 'message-a', providerStatus: 'message-reconciled',
    });
    expect(sendGmail).not.toHaveBeenCalled();
    expect(gmail).toHaveBeenCalledOnce();
  });

  it('records ambiguity and never scans or resends without the separately granted metadata capability', async () => {
    const gmailAmbiguity = vi.fn(async () => undefined);
    const unresolved = vi.fn(async () => undefined);
    const sendGmail = vi.fn(async () => { throw new TypeError('connection reset after request'); });
    const findSentMessageByClientMessageId = vi.fn();
    let reconciliation = false;
    const adapter = new GoogleConnectorAdapter({ load: async () => ({
      operation: { kind: 'gmail.send', rawMessageBase64Url: 'cmF3', clientMessageId: 'key@omnix.local',
        normalizedRecipient: 'buyer@example.com', contactId: 'contact-a', contactPointId: 'point-a', aliasEpoch: 4 },
      client: { sendGmail, findSentMessageByClientMessageId, createOmnixCalendar: vi.fn(),
        upsertOmnixCalendarEvent: vi.fn(), getOmnixCalendarEvent: vi.fn(), deleteOmnixCalendarEvent: vi.fn() },
      bind: { gmailAmbiguity },
      ...(reconciliation ? { gmailReconciliation: {
        strategy: 'unavailable-no-resend' as const, markerHash: 'a'.repeat(64), maxScan: 100, unresolved,
      } } : {}),
    }) });
    await expect(adapter.execute(job)).resolves.toMatchObject({ outcome: 'unknown' });
    expect(gmailAmbiguity).toHaveBeenCalledOnce();
    reconciliation = true;
    await expect(adapter.reconcile({ ...job, state: 'reconciliation-required' }))
      .resolves.toMatchObject({ outcome: 'unknown' });
    expect(sendGmail).toHaveBeenCalledOnce();
    expect(findSentMessageByClientMessageId).not.toHaveBeenCalled();
    expect(unresolved).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'unavailable' }));
  });

  it('deletes only the bound Omnix event for a completed task and records lifecycle evidence', async () => {
    const deleteOmnixCalendarEvent = vi.fn(async () => undefined);
    const taskLifecycle = vi.fn(async () => undefined);
    const lifecycleJob = { ...job, actionType: 'calendar.complete-omnix-event' };
    const adapter = new GoogleConnectorAdapter({ load: async () => ({
      operation: {
        kind: 'calendar.complete-omnix-event', taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        taskVersion: 2, taskStatus: 'completed', resourceKey: 'a'.repeat(64), eventId: 'event123',
      },
      client: { sendGmail: vi.fn(), findSentMessageByClientMessageId: vi.fn(), createOmnixCalendar: vi.fn(),
        upsertOmnixCalendarEvent: vi.fn(), getOmnixCalendarEvent: vi.fn(), deleteOmnixCalendarEvent },
      calendarId: 'omnix-calendar', bind: { taskLifecycle },
    }) });
    await expect(adapter.execute(lifecycleJob)).resolves.toMatchObject({
      outcome: 'succeeded', providerStatus: 'complete',
    });
    expect(deleteOmnixCalendarEvent).toHaveBeenCalledWith({ calendarId: 'omnix-calendar', eventId: 'event123' });
    expect(taskLifecycle).toHaveBeenCalledWith(expect.objectContaining({ taskVersion: 2, eventId: 'event123' }));
  });

  it('requires and revokes the lease-scoped refresh token before confirmed disconnect', async () => {
    const revoke = vi.fn(async () => undefined);
    const adapter = new GoogleConnectorAdapter({ load: vi.fn() }, revoke);
    await expect(adapter.revoke({
      id: 'connection-a', workspaceId: 'workspace-a', provider: 'google', remoteAccountId: 'account-a',
      grantedScopes: [], status: 'revoking', connectedAt: '2026-08-12T12:00:00Z', updatedAt: '2026-08-12T12:00:00Z',
    }, 'refresh-token')).resolves.toMatchObject({ outcome: 'succeeded', providerStatus: 'provider-confirmed' });
    expect(revoke).toHaveBeenCalledWith('refresh-token');
  });
});

