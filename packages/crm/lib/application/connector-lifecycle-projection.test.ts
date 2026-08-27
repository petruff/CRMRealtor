import { describe, expect, it } from 'vitest';
import { ConnectorError, type ConnectorConnection, type ConnectorDefinition } from '../domain/connector.ts';
import type { GoogleCapabilityState } from '../data/google-operation-repository.ts';
import type { MailchimpAudienceBinding } from '../domain/mailchimp.ts';
import type { MailchimpReconciliationRun } from '../data/supabase-mailchimp-reconciliation-repository.ts';
import type { MailchimpOutboundBackfillRun } from '../data/mailchimp-outbound-backfill-repository.ts';
import {
  GOOGLE_LIFECYCLE_REQUIRED_SCOPES,
  readGoogleLifecycle,
  readMailchimpLifecycle,
} from './connector-lifecycle-projection.ts';

const NOW = new Date('2026-08-25T12:00:00.000Z');

function definition(provider: 'google' | 'mailchimp'): ConnectorDefinition {
  return {
    provider,
    label: provider,
    mode: 'live',
    enabled: true,
    capabilities: [],
    productionRequirements: [],
  };
}

function connection(provider: 'google' | 'mailchimp'): ConnectorConnection {
  return {
    id: `connection-${provider}`,
    workspaceId: 'workspace-1',
    provider,
    remoteAccountId: 'redacted',
    grantedScopes: provider === 'google' ? GOOGLE_LIFECYCLE_REQUIRED_SCOPES : [],
    status: 'active',
    connectedAt: '2026-08-25T10:00:00.000Z',
    updatedAt: '2026-08-25T11:59:00.000Z',
  };
}

function googleState(overrides: Partial<GoogleCapabilityState> = {}): GoogleCapabilityState {
  return {
    connection: {
      id: 'connection-google', workspaceId: 'workspace-1', status: 'active', displayLabel: 'Google',
      accountKeyHash: 'redacted', grantedScopes: GOOGLE_LIFECYCLE_REQUIRED_SCOPES,
      lastProbeAt: '2026-08-25T11:59:00.000Z',
    },
    capabilities: [
      { bundle: 'gmail-send', requiredScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[0]], grantedScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[0]], state: 'active' },
      { bundle: 'gmail-metadata', requiredScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[1]], grantedScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[1]], state: 'active' },
      { bundle: 'calendar-app-created', requiredScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[2]], grantedScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[2]], state: 'active' },
    ],
    sync: [
      { stream: 'gmail-history', state: 'healthy', cursorGeneration: 1 },
      { stream: 'calendar-events', state: 'healthy', cursorGeneration: 1 },
    ],
    calendar: { created: true },
    tokenState: { refreshPresent: true },
    ...overrides,
  };
}

function binding(overrides: Partial<MailchimpAudienceBinding> = {}): MailchimpAudienceBinding {
  return {
    id: 'binding-1', connectionId: 'connection-mailchimp', accountIdHash: 'redacted', dataCenter: 'us1',
    audienceId: 'audience-1', audienceName: 'Clients', mappingVersion: 1,
    selectedAt: '2026-08-25T11:00:00.000Z', baselineRequired: false,
    webhookRegistrationRequired: false, ...overrides,
  };
}

function reconciliation(overrides: Partial<MailchimpReconciliationRun> = {}): MailchimpReconciliationRun {
  return {
    id: 'reconciliation-1', workspaceId: 'workspace-1', connectionId: 'connection-mailchimp',
    bindingId: 'binding-1', mode: 'reconcile', state: 'succeeded', snapshotHash: 'redacted',
    pageSize: 100, nextOffset: 0, pagesApplied: 1, itemsSeen: 10, itemsApplied: 10,
    itemsReviewed: 0, itemsBlocked: 0, attemptCount: 1, maxAttempts: 3, fencingToken: 1,
    correlationId: 'correlation-1', ...overrides,
  };
}

function backfill(overrides: Partial<MailchimpOutboundBackfillRun> = {}): MailchimpOutboundBackfillRun {
  return {
    id: 'backfill-1', workspaceId: 'workspace-1', connectionId: 'connection-mailchimp', bindingId: 'binding-1',
    mode: 'backfill', mappingVersion: 1, snapshotHash: 'redacted', eligibleCount: 10, pageSize: 100,
    state: 'succeeded', nextOffset: 10, jobsEnqueued: 10, attemptCount: 1, maxAttempts: 3,
    correlationId: 'correlation-2', requestOrigin: 'owner', fencingToken: 1,
    previewedAt: '2026-08-25T10:00:00.000Z', completedAt: '2026-08-25T11:00:00.000Z', ...overrides,
  };
}

describe('connector lifecycle provider projections', () => {
  it('requires current exact Google scopes, refresh authority, and healthy capability reads', async () => {
    const ready = await readGoogleLifecycle({
      definition: definition('google'), connection: connection('google'), observedAt: NOW,
      readOwnerAuthorization: async () => true,
      readCapabilities: async () => googleState(),
    });
    expect(ready.projection.state).toBe('ready');

    const partial = await readGoogleLifecycle({
      definition: definition('google'),
      connection: { ...connection('google'), grantedScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[0]] },
      observedAt: NOW,
      readOwnerAuthorization: async () => true,
      readCapabilities: async () => googleState({
        connection: { ...googleState().connection, grantedScopes: [GOOGLE_LIFECYCLE_REQUIRED_SCOPES[0]] },
      }),
    });
    expect(partial.projection.state).toBe('scope-pending');
    expect(partial.projection.missingScopes).toHaveLength(2);
  });

  it('fails closed for stale or failed Google reads', async () => {
    const stale = await readGoogleLifecycle({
      definition: definition('google'), connection: connection('google'), observedAt: NOW,
      readOwnerAuthorization: async () => true,
      readCapabilities: async () => googleState({
        connection: { ...googleState().connection, lastProbeAt: '2026-08-25T10:00:00.000Z' },
      }),
    });
    expect(stale.projection).toMatchObject({ state: 'degraded', providerEvidence: 'stale' });

    const failed = await readGoogleLifecycle({
      definition: definition('google'), connection: connection('google'), observedAt: NOW,
      readOwnerAuthorization: async () => true,
      readCapabilities: async () => { throw new Error('provider read failed'); },
    });
    expect(failed.projection.state).toBe('degraded');
    expect(failed.failures[0]?.operation).toBe('capabilities');
  });

  it('does not infer canonical-owner authorization from a healthy connection row', async () => {
    const google = await readGoogleLifecycle({
      definition: definition('google'), connection: connection('google'), observedAt: NOW,
      readCapabilities: async () => googleState(),
    });
    const mailchimp = await readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readBinding: async () => binding(), readReconciliation: async () => [reconciliation()],
      readBackfills: async () => [backfill()],
    });
    expect(google.projection.state).toBe('degraded');
    expect(mailchimp.projection.state).toBe('degraded');
  });

  it('bounds a stalled required provider read and degrades instead of hanging or guessing', async () => {
    const result = await readGoogleLifecycle({
      definition: definition('google'), connection: connection('google'), observedAt: NOW,
      readOwnerAuthorization: async () => true, timeoutMs: 1,
      readCapabilities: () => new Promise<GoogleCapabilityState>(() => undefined),
    });
    expect(result.projection).toMatchObject({ state: 'degraded', providerEvidence: 'missing' });
    expect(result.failures).toHaveLength(1);
  });

  it('requires Mailchimp audience, webhook, baseline, reconciliation, and backfill truth', async () => {
    const ready = await readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readOwnerAuthorization: async () => true,
      readBinding: async () => binding(),
      readReconciliation: async () => [reconciliation()],
      readBackfills: async () => [backfill()],
    });
    expect(ready.projection.state).toBe('ready');

    const webhookPending = await readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readOwnerAuthorization: async () => true,
      readBinding: async () => binding({ webhookRegistrationRequired: true }),
      readReconciliation: async () => [reconciliation()],
      readBackfills: async () => [backfill()],
    });
    expect(webhookPending.projection.state).toBe('webhook-pending');

    const baselineRunning = await readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readOwnerAuthorization: async () => true,
      readBinding: async () => binding({ baselineRequired: true }),
      readReconciliation: async () => [reconciliation({ mode: 'baseline', state: 'executing' })],
      readBackfills: async () => [backfill()],
    });
    expect(baselineRunning.projection.state).toBe('baseline-running');
  });

  it.each([
    ['reconciliation', async () => readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readOwnerAuthorization: async () => true,
      readBinding: async () => binding(), readReconciliation: async () => { throw new Error('failed'); },
      readBackfills: async () => [backfill()],
    })],
    ['backfill', async () => readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readOwnerAuthorization: async () => true,
      readBinding: async () => binding(), readReconciliation: async () => [reconciliation()],
      readBackfills: async () => { throw new Error('failed'); },
    })],
  ])('makes a %s read failure degrade the canonical state', async (_operation, run) => {
    expect((await run()).projection.state).toBe('degraded');
  });

  it('makes an authorization-rejected audience read reconnect-required while keeping transient listing failures nonblocking', async () => {
    const run = (error: Error) => readMailchimpLifecycle({
      definition: definition('mailchimp'), connection: connection('mailchimp'), observedAt: NOW,
      readAuthorization: async () => true,
      readOwnerAuthorization: async () => true,
      readBinding: async () => binding(),
      readReconciliation: async () => [reconciliation()],
      readBackfills: async () => [backfill()],
      readAudiences: async () => { throw error; },
    });

    const rejected = await run(new ConnectorError('forbidden', 'provider rejected token'));
    expect(rejected.projection).toMatchObject({
      state: 'reconnect-required',
      ownerAction: 'reconnect',
      safeSummary: 'Reconnect this account to restore updates.',
    });
    expect(rejected.projection.state).not.toBe('ready');

    const transient = await run(new ConnectorError('provider-retryable', 'provider options unavailable'));
    expect(transient.projection.state).toBe('ready');
    expect(transient.failures).toContainEqual(expect.objectContaining({ operation: 'audiences' }));
  });
});
