import { describe, expect, it, vi } from 'vitest';
import { loadGoogleConfiguredRuntimeConfiguration } from '../config/connector-runtime';
import type { ConnectorRepository } from '../data/connector-repository';
import type { GoogleOperationRepository } from '../data/google-operation-repository';
import { createEnvironmentKekResolver } from '../security/connector-secret-envelope';
import {
  prepareGoogleCalendarCreationIntent,
  prepareGoogleCalendarTaskIntent,
  prepareGoogleCalendarTaskLifecycleIntent,
  prepareGoogleGmailSendIntent,
  prepareGoogleSyncIntent,
} from './google-operations';

const scope = {
  authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'membership-a',
  workspaceId: 'workspace-a', role: 'assistant' as const, mode: 'live' as const,
};
const configuration = loadGoogleConfiguredRuntimeConfiguration({
  OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true', GOOGLE_CONNECTOR_CLIENT_ID: 'client-a',
  GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret-a',
  GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
});
const resolver = createEnvironmentKekResolver({
  OMNIX_CONNECTOR_KEK_ACTIVE_VERSION: 'test-kek',
  'OMNIX_CONNECTOR_KEK_test-kek': Buffer.alloc(32, 7).toString('base64'),
});
const outboundGuard = {
  assertTarget: vi.fn(async (_scope, contactId: string, contactPointId: string) => ({
    contactId, contactPointId, aliasEpoch: 4,
  })),
};

function repositories() {
  const createIntent = vi.fn(async (_scope, input) => ({ id: 'intent-a', workspaceId: scope.workspaceId, version: 1, status: 'pending', ...input }));
  const operations = {
    storeEncryptedPayload: vi.fn(async (_scope, input) => ({ payloadReference: 'payload-a', payloadHash: input.canonicalHash, envelopeVersion: 1 })),
    ensurePolicy: vi.fn(async () => ({ id: 'policy-a', version: 1, noOp: false })),
  } as unknown as GoogleOperationRepository;
  const connector = {
    getConnection: vi.fn(async () => ({
      id: 'connection-a', workspaceId: scope.workspaceId, provider: 'google',
      remoteAccountId: 'a'.repeat(64), grantedScopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.metadata',
        'https://www.googleapis.com/auth/calendar.app.created',
      ], status: 'active', connectedAt: '2026-08-12T12:00:00Z', updatedAt: '2026-08-12T12:00:00Z',
    })),
    createIntent,
  } as unknown as ConnectorRepository;
  return { connector, operations, createIntent };
}

describe('Google governed operations', () => {
  it('prepares a dedicated non-primary Omnix Calendar intent behind owner approval', async () => {
    const { connector, operations, createIntent } = repositories();
    await prepareGoogleCalendarCreationIntent(connector, operations, configuration, scope, {
      connectionId: 'connection-a', correlationId: 'correlation-a',
    }, { resolver }, new Date('2026-08-12T12:00:00Z'));
    expect(operations.storeEncryptedPayload).toHaveBeenCalledWith(scope, expect.objectContaining({
      payloadKind: 'calendar.create-omnix-calendar', schemaVersion: 'google-calendar-create.v1',
    }));
    expect(createIntent).toHaveBeenCalledWith(scope, expect.objectContaining({
      actionType: 'calendar.create-omnix-calendar',
      complianceSnapshot: expect.objectContaining({ primaryCalendar: false }),
    }));
  });

  it('stores encrypted MIME and creates a pending owner-approved Gmail intent', async () => {
    const { connector, operations, createIntent } = repositories();
    await prepareGoogleGmailSendIntent(connector, operations, configuration, scope, {
      connectionId: 'connection-a', contactId: 'contact-a', contactPointId: 'point-a',
      from: 'owner@example.com', to: 'buyer@example.com', subject: 'Showing', body: 'See you tomorrow.',
    }, { resolver, outboundGuard }, new Date('2026-08-12T12:00:00Z'));
    expect(operations.storeEncryptedPayload).toHaveBeenCalledWith(scope, expect.objectContaining({
      payloadKind: 'gmail.send', envelope: expect.objectContaining({ ciphertext: expect.any(String) }),
    }));
    expect(createIntent).toHaveBeenCalledWith(scope, expect.objectContaining({
      actionType: 'gmail.send', complianceSnapshot: expect.objectContaining({ bodyInReceipt: false, aliasEpoch: 4 }),
    }));
    expect(outboundGuard.assertTarget).toHaveBeenCalledWith(scope, 'contact-a', 'point-a');
  });

  it('fails closed before storing Gmail content when the reviewed target is an alias donor', async () => {
    const { connector, operations, createIntent } = repositories();
    const refusingGuard = {
      assertTarget: vi.fn(async () => { throw new Error('Outbound target requires manual review: aliased donor'); }),
    };
    await expect(prepareGoogleGmailSendIntent(connector, operations, configuration, scope, {
      connectionId: 'connection-a', contactId: 'donor-a', contactPointId: 'point-a',
      from: 'owner@example.com', to: 'buyer@example.com', subject: 'Showing', body: 'See you tomorrow.',
    }, { resolver, outboundGuard: refusingGuard }, new Date('2026-08-12T12:00:00Z')))
      .rejects.toThrow(/manual review.*aliased donor/i);
    expect(operations.storeEncryptedPayload).not.toHaveBeenCalled();
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('prepares bounded metadata-only sync without requesting Gmail content', async () => {
    const { connector, operations, createIntent } = repositories();
    await prepareGoogleSyncIntent(connector, operations, configuration, scope, {
      connectionId: 'connection-a', actionType: 'gmail.sync-metadata', correlationId: 'correlation-a',
    }, { resolver }, new Date('2026-08-12T12:00:00Z'));
    expect(createIntent).toHaveBeenCalledWith(scope, expect.objectContaining({
      actionType: 'gmail.sync-metadata',
      complianceSnapshot: expect.objectContaining({ metadataOnly: true, bodyRequested: false, boundedPageSize: 500 }),
    }));
  });

  it('uses a stable task resource key and rejects an unknown timezone', async () => {
    const { connector, operations, createIntent } = repositories();
    const input = {
      connectionId: 'connection-a', taskId: 'task-a', taskVersion: 2, title: 'Call Ada',
      startAt: '2026-08-12T14:00:00Z', endAt: '2026-08-12T14:30:00Z', timeZone: 'America/New_York',
    };
    await prepareGoogleCalendarTaskIntent(connector, operations, configuration, scope, input, { resolver });
    const resourceKey = (createIntent.mock.calls[0]?.[1] as { complianceSnapshot: { resourceKey: string } }).complianceSnapshot.resourceKey;
    expect(resourceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(operations.storeEncryptedPayload).toHaveBeenCalledWith(scope, expect.objectContaining({
      envelope: expect.any(Object),
    }));
    await expect(prepareGoogleCalendarTaskIntent(connector, operations, configuration, scope, {
      ...input, timeZone: 'Mars/Olympus',
    }, { resolver })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('binds completion and cancellation to the canonical task state and exact Omnix event', async () => {
    const { connector, operations, createIntent } = repositories();
    await prepareGoogleCalendarTaskLifecycleIntent(connector, operations, configuration, scope, {
      connectionId: 'connection-a', taskId: 'task-a', taskVersion: 3,
      taskStatus: 'completed', lifecycle: 'complete', correlationId: 'correlation-a',
    }, { resolver });
    expect(createIntent).toHaveBeenCalledWith(scope, expect.objectContaining({
      actionType: 'calendar.complete-omnix-event',
      complianceSnapshot: expect.objectContaining({ exactBoundEventOnly: true, taskStatus: 'completed' }),
    }));
    await expect(prepareGoogleCalendarTaskLifecycleIntent(connector, operations, configuration, scope, {
      connectionId: 'connection-a', taskId: 'task-a', taskVersion: 3,
      taskStatus: 'completed', lifecycle: 'cancel',
    }, { resolver })).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
