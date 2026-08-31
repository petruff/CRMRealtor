import { describe, expect, it, vi } from 'vitest';
import { loadGoogleConfiguredRuntimeConfiguration } from '../config/connector-runtime';
import type { GoogleGmailWakeupRepository } from '../data/supabase-google-gmail-wakeup-repository';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '../security/connector-secret-envelope';
import { drainGoogleGmailWakeups } from './google-gmail-wakeup-worker';

const resolver = createEnvironmentKekResolver({
  OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'v1',
  OMNIX_CONNECTOR_KEK_v1: Buffer.alloc(32, 7).toString('base64'),
});
const job = {
  id: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222',
  connectionId: '33333333-3333-4333-8333-333333333333', state: 'leased', attemptCount: 0,
  maxAttempts: 5, fencingToken: 1, correlationId: '44444444-4444-4444-8444-444444444444',
  jobKind: 'history-sync' as const,
};

function encrypted(value: string, secretType: string, version: number) {
  return { ...encryptConnectorSecret(value, {
    workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'google',
    secretType, recordVersion: version,
  }, resolver), secretVersion: version };
}

describe('Google Gmail push wake-up worker', () => {
  it('uses history.list as authority, binds minimized metadata and advances the private cursor', async () => {
    const cursorValue = JSON.stringify({ historyId: '100', startHistoryId: '100', pageToken: null });
    const bindMetadata = vi.fn(async () => ({ linkState: 'linked', contactId: 'contact-a' }));
    const repository = {
      schedule: vi.fn(async () => 0),
      claim: vi.fn(async () => [job]), start: vi.fn(async () => ({ ...job, state: 'executing', attemptCount: 1 })),
      read: vi.fn(async () => ({
        job: { ...job, state: 'executing', attemptCount: 1, wakeGeneration: 1, claimedGeneration: 1 },
        connectionEmail: 'owner@example.com', accessState: 'live', grantedScopes: ['https://www.googleapis.com/auth/gmail.metadata'],
        access: encrypted('access-token', 'google-access-token', 1),
        cursor: { version: 1, envelope: encrypted(cursorValue, 'google.gmail-history', 1) },
        watch: { resourceVersion: 1, bindingVersion: 1, expiresAt: '2026-08-18T12:00:00Z', subscriptionHash: 'a'.repeat(64) },
      })),
      refresh: vi.fn(), bindMetadata,
      commit: vi.fn(async () => false), transition: vi.fn(async () => undefined),
    } as unknown as GoogleGmailWakeupRepository;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        historyId: '102', history: [{ messagesAdded: [{ message: { id: 'message-a' } }] }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'message-a', threadId: 'thread-a', internalDate: '1786550400000', labelIds: ['INBOX'],
        payload: { headers: [{ name: 'From', value: 'buyer@example.com' },
          { name: 'To', value: 'owner@example.com' }, { name: 'Message-ID', value: '<provider@example.com>' }] },
      }), { status: 200 }));
    const result = await drainGoogleGmailWakeups({
      repository, configuration: loadGoogleConfiguredRuntimeConfiguration({
        OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true', GOOGLE_CONNECTOR_CLIENT_ID: 'client-a',
        GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret-a',
        GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
      }),
      workerId: '55555555-5555-4555-8555-555555555555',
      deadlineMs: new Date('2026-08-12T12:01:00Z').getTime(),
      now: () => new Date('2026-08-12T12:00:00Z'), resolver, fetcher,
    });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, messages: 1 });
    expect(repository.bindMetadata).toHaveBeenCalledWith(expect.objectContaining({
      counterpartEmail: 'buyer@example.com', direction: 'incoming',
    }));
    expect(repository.commit).toHaveBeenCalledWith(expect.objectContaining({ checkpointHash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(JSON.stringify(bindMetadata.mock.calls)).not.toMatch(/subject|body/i);
  });

  it('recovers an expired cursor with one bounded full scan before resuming history', async () => {
    const repository = {
      schedule: vi.fn(async () => 0),
      claim: vi.fn(async () => [job]), start: vi.fn(async () => ({ ...job, state: 'executing', attemptCount: 1 })),
      read: vi.fn(async () => ({
        job: { ...job, state: 'executing', attemptCount: 1, wakeGeneration: 2, claimedGeneration: 2 },
        connectionEmail: 'owner@example.com', accessState: 'live', grantedScopes: ['https://www.googleapis.com/auth/gmail.metadata'],
        access: encrypted('access-token', 'google-access-token', 1),
        watch: { resourceVersion: 1, bindingVersion: 1, expiresAt: '2026-08-18T12:00:00Z', subscriptionHash: 'a'.repeat(64) },
      })),
      refresh: vi.fn(), bindMetadata: vi.fn(async () => ({ linkState: 'linked' })),
      commit: vi.fn(async () => false), transition: vi.fn(async () => undefined),
    } as unknown as GoogleGmailWakeupRepository;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: 'owner@example.com', historyId: '200' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    const result = await drainGoogleGmailWakeups({
      repository, configuration: loadGoogleConfiguredRuntimeConfiguration({
        OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true', GOOGLE_CONNECTOR_CLIENT_ID: 'client-a',
        GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret-a',
        GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
      }),
      workerId: '55555555-5555-4555-8555-555555555555',
      deadlineMs: new Date('2026-08-12T12:01:00Z').getTime(),
      now: () => new Date('2026-08-12T12:00:00Z'), resolver, fetcher,
    });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, messages: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(repository.commit).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: null, hasMore: false,
    }));
  });

  it('classifies a linked incoming reply only after restricted-scope owner opt-in', async () => {
    const recordIntelligence = vi.fn(async () => undefined);
    const repository = {
      schedule: vi.fn(async () => 0), claim: vi.fn(async () => [job]),
      start: vi.fn(async () => ({ ...job, state: 'executing', attemptCount: 1 })),
      read: vi.fn(async () => ({
        job: { ...job, state: 'executing', attemptCount: 1, wakeGeneration: 1, claimedGeneration: 1 },
        connectionEmail: 'owner@example.com', accessState: 'live',
        grantedScopes: ['https://www.googleapis.com/auth/gmail.metadata', 'https://www.googleapis.com/auth/gmail.readonly'],
        access: encrypted('access-token', 'google-access-token', 1),
        cursor: { version: 1, envelope: encrypted(JSON.stringify({ historyId: '100', startHistoryId: '100' }), 'google.gmail-history', 1) },
        watch: { resourceVersion: 1, bindingVersion: 1, expiresAt: '2026-08-18T12:00:00Z', subscriptionHash: 'a'.repeat(64) },
      })),
      refresh: vi.fn(), bindMetadata: vi.fn(async () => ({ linkState: 'linked', contactId: 'contact-a' })),
      recordIntelligence, commit: vi.fn(async () => false), transition: vi.fn(async () => undefined),
    } as unknown as GoogleGmailWakeupRepository;
    const content = Buffer.from('Can we schedule a showing tomorrow?', 'utf8').toString('base64url');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ historyId: '102', history: [{ messagesAdded: [{ message: { id: 'message-a' } }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'message-a', threadId: 'thread-a', internalDate: '1786550400000', labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'buyer@example.com' }, { name: 'To', value: 'owner@example.com' }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'message-a', threadId: 'thread-a', payload: { mimeType: 'text/plain', body: { data: content } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'scheduling', sentiment: 'positive', urgency: 'high', summary: 'The buyer asked to schedule a showing tomorrow.', unknowns: [] }) }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 } }), { status: 200 }));
    const budget = { reserve: vi.fn(async () => ({ allowed: true, reservationId: 'reservation-a' })), finalize: vi.fn(async () => undefined) };
    const result = await drainGoogleGmailWakeups({
      repository, configuration: loadGoogleConfiguredRuntimeConfiguration({ OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true', GOOGLE_CONNECTOR_CLIENT_ID: 'client-a', GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret-a', GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback' }),
      workerId: '55555555-5555-4555-8555-555555555555', deadlineMs: new Date('2026-08-12T12:01:00Z').getTime(),
      now: () => new Date('2026-08-12T12:00:00Z'), resolver, fetcher,
      intelligence: {
        loadCredential: async () => ({ credential: { apiKey: 'gemini-key', provider: 'google-gemini', model: 'gemini-3.5-flash-lite', dataPolicy: 'paid-private' }, ownerMembershipId: 'owner-member-a' }),
        createBudget: () => budget,
      },
    });
    expect(result.classified).toBe(1);
    expect(recordIntelligence).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ state: 'classified', intent: 'scheduling' }),
    }));
    expect(budget.finalize).toHaveBeenCalledWith(expect.objectContaining({ state: 'succeeded' }));
  });

  it('schedules and renews an expiring Gmail watch without reading mailbox metadata', async () => {
    const renewal = { ...job, jobKind: 'watch-renewal' as const };
    const renew = vi.fn(async () => undefined);
    const repository = {
      schedule: vi.fn(async () => 1), claim: vi.fn(async () => [renewal]),
      start: vi.fn(async () => ({ ...renewal, state: 'executing', attemptCount: 1 })),
      read: vi.fn(async () => ({
        job: { ...renewal, state: 'executing', attemptCount: 1, wakeGeneration: 1, claimedGeneration: 1 },
        connectionEmail: 'owner@example.com', accessState: 'live', grantedScopes: ['https://www.googleapis.com/auth/gmail.metadata'],
        access: encrypted('access-token', 'google-access-token', 1),
        watch: { resourceVersion: 2, bindingVersion: 3, expiresAt: '2026-08-13T12:00:00Z', subscriptionHash: 'a'.repeat(64) },
      })),
      refresh: vi.fn(), renew, bindMetadata: vi.fn(), commit: vi.fn(), transition: vi.fn(),
    } as unknown as GoogleGmailWakeupRepository;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      historyId: '300', expiration: String(new Date('2026-08-19T12:00:00Z').getTime()),
    }), { status: 200 }));
    const result = await drainGoogleGmailWakeups({
      repository, configuration: loadGoogleConfiguredRuntimeConfiguration({
        OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true', GOOGLE_CONNECTOR_CLIENT_ID: 'client-a',
        GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret-a', GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
      }), workerId: '55555555-5555-4555-8555-555555555555',
      deadlineMs: new Date('2026-08-12T12:01:00Z').getTime(), now: () => new Date('2026-08-12T12:00:00Z'),
      resolver, fetcher, gmailPush: {
        topicName: 'projects/example-project/topics/omnix-gmail', subscriptionName: 'projects/example-project/subscriptions/omnix-gmail',
        audience: 'https://crm.example.com/api/connectors/google/gmail/push/key', serviceAccountEmail: 'push@example.iam.gserviceaccount.com',
        endpointKey: 'key', externalUrl: 'https://crm.example.com/api/connectors/google/gmail/push/key',
        endpointKeyHash: 'b'.repeat(64), exactExternalUrlHash: 'c'.repeat(64),
        subscriptionHash: 'a'.repeat(64), oidcAudienceHash: 'd'.repeat(64),
      },
    });
    expect(result).toMatchObject({ scheduled: 1, claimed: 1, succeeded: 1, messages: 0 });
    expect(renew).toHaveBeenCalledWith(expect.objectContaining({ expectedWatchVersion: 2, expectedBindingVersion: 3 }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
