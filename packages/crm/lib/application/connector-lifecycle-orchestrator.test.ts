import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  canRecoverMailchimpLifecycle,
  canShowMailchimpManagement,
  connectionCardStatus,
  SETUP_UNAVAILABLE_LABEL,
} from '../../app/connections/connection-status.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import type { GoogleCapabilityState } from '../data/google-operation-repository.ts';
import { ConnectorError, type ConnectorConnection, type ConnectorDefinition } from '../domain/connector.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import { GOOGLE_LIFECYCLE_REQUIRED_SCOPES } from './connector-lifecycle-projection.ts';
import {
  connectorLifecycleReadiness,
  readMailchimpCanonicalOwnerAuthorization,
  readConnectorLifecycleSnapshot,
  type ConnectorLifecycleProviderReaders,
} from './connector-lifecycle-orchestrator.ts';
import { connectionsResult } from './omnix-copilot-service.ts';

const OBSERVED_AT = new Date('2026-08-25T12:00:00.000Z');
const definitions: readonly ConnectorDefinition[] = [
  { provider: 'google', label: 'Google Workspace', mode: 'live', enabled: true, capabilities: [], productionRequirements: [] },
  { provider: 'mailchimp', label: 'Mailchimp', mode: 'live', enabled: true, capabilities: [], productionRequirements: [] },
];
const connections: readonly ConnectorConnection[] = [
  {
    id: 'connection-google', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, provider: 'google',
    remoteAccountId: 'redacted-google', grantedScopes: GOOGLE_LIFECYCLE_REQUIRED_SCOPES,
    status: 'active', connectedAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T11:59:00.000Z',
  },
  {
    id: 'connection-mailchimp', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, provider: 'mailchimp',
    remoteAccountId: 'redacted-mailchimp', grantedScopes: ['audience.sync', 'audience.reconcile'],
    status: 'active', connectedAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T11:59:00.000Z',
  },
];

function googleCapabilities(): GoogleCapabilityState {
  return {
    connection: {
      id: 'connection-google', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId, status: 'active',
      displayLabel: 'Google Workspace', accountKeyHash: 'redacted',
      grantedScopes: GOOGLE_LIFECYCLE_REQUIRED_SCOPES, lastProbeAt: '2026-08-25T11:59:00.000Z',
    },
    capabilities: GOOGLE_LIFECYCLE_REQUIRED_SCOPES.map((scope, index) => ({
      bundle: ['gmail-send', 'gmail-metadata', 'calendar-app-created'][index] as 'gmail-send' | 'gmail-metadata' | 'calendar-app-created',
      requiredScopes: [scope], grantedScopes: [scope], state: 'active' as const,
    })),
    sync: [
      { stream: 'gmail-history', state: 'healthy', cursorGeneration: 1 },
      { stream: 'calendar-events', state: 'healthy', cursorGeneration: 1 },
    ],
    calendar: { created: true },
    tokenState: { refreshPresent: true },
  };
}

function readyReaders(overrides: Partial<ConnectorLifecycleProviderReaders> = {}): ConnectorLifecycleProviderReaders {
  return {
    readGoogleCapabilities: async () => googleCapabilities(),
    readGoogleOwnerBinding: async () => true,
    readMailchimpAuthorization: async () => true,
    readMailchimpOwnerBinding: async () => true,
    readMailchimpBinding: async () => ({
      id: 'binding-1', connectionId: 'connection-mailchimp', accountIdHash: 'redacted', dataCenter: 'us1',
      audienceId: 'audience-1', audienceName: 'Clients', mappingVersion: 1,
      selectedAt: '2026-08-25T11:00:00.000Z', baselineRequired: false,
      webhookRegistrationRequired: false,
    }),
    readMailchimpReconciliations: async () => [{
      id: 'reconciliation-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
      connectionId: 'connection-mailchimp', bindingId: 'binding-1', mode: 'reconcile', state: 'succeeded',
      snapshotHash: 'redacted', pageSize: 100, nextOffset: 0, pagesApplied: 1, itemsSeen: 10,
      itemsApplied: 10, itemsReviewed: 0, itemsBlocked: 0, attemptCount: 1, maxAttempts: 3,
      fencingToken: 1, correlationId: 'correlation-1',
    }],
    readMailchimpBackfills: async () => [{
      id: 'backfill-1', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
      connectionId: 'connection-mailchimp', bindingId: 'binding-1', mode: 'backfill', mappingVersion: 1,
      snapshotHash: 'redacted', eligibleCount: 10, pageSize: 100, state: 'succeeded', nextOffset: 10,
      jobsEnqueued: 10, attemptCount: 1, maxAttempts: 3, correlationId: 'correlation-2',
      requestOrigin: 'owner', fencingToken: 1, previewedAt: '2026-08-25T10:00:00.000Z',
      completedAt: '2026-08-25T11:00:00.000Z',
    }],
    ...overrides,
  };
}

async function snapshot(readers = readyReaders()) {
  return readConnectorLifecycleSnapshot({
    connectorRepository: {} as ConnectorRepository,
    workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    isLive: true,
    definitions,
    connections,
    observedAt: OBSERVED_AT,
    readers,
  });
}

describe('connector lifecycle orchestrator', () => {
  it('establishes a legitimate ready path from bounded provider facts and persisted owner evidence', async () => {
    const result = await snapshot();
    expect(result.lifecycles.map((lifecycle) => [lifecycle.provider, lifecycle.state])).toEqual([
      ['google', 'ready'],
      ['mailchimp', 'ready'],
    ]);
  });

  it.each([
    ['Google owner binding', { readGoogleOwnerBinding: async () => false }, 'google'],
    ['Mailchimp authorization', { readMailchimpAuthorization: async () => { throw new Error('unavailable'); } }, 'mailchimp'],
    ['Mailchimp owner binding', { readMailchimpOwnerBinding: async () => false }, 'mailchimp'],
  ] as const)('fails closed when %s is not proven', async (_label, override, provider) => {
    const result = await snapshot(readyReaders(override));
    expect(result.lifecycles.find((lifecycle) => lifecycle.provider === provider)?.state).toBe('degraded');
  });

  it('treats legacy creator identity plus an ambiguous OAuth receipt as needs-attention', async () => {
    const result = await snapshot(readyReaders({
      readMailchimpAuthorization: async () => true,
      readMailchimpOwnerBinding: async () => false,
    }));
    const lifecycle = result.mailchimp.lifecycle;

    expect(lifecycle.state).toBe('degraded');
    expect(connectionCardStatus(lifecycle)).toEqual({ status: 'review', label: 'Needs attention' });
  });

  it('accepts only the boolean canonical-owner evidence returned by the database proof', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    await expect(readMailchimpCanonicalOwnerAuthorization(
      { rpc } as unknown as SupabaseClient,
      SAMPLE_WORKSPACE_SCOPE,
      'connection-mailchimp',
    )).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('read_mailchimp_owner_authorization_evidence', {
      target_connection_id: 'connection-mailchimp',
    });

    await expect(readMailchimpCanonicalOwnerAuthorization(
      { rpc: vi.fn(async () => ({ data: { forged: true }, error: null })) } as unknown as SupabaseClient,
      SAMPLE_WORKSPACE_SCOPE,
      'connection-mailchimp',
    )).rejects.toThrow('owner-binding evidence is unavailable');
  });

  it('keeps Connections, readiness, and Omnix on the exact same lifecycle state and summary', async () => {
    const result = await snapshot();
    const readiness = connectorLifecycleReadiness(result.lifecycles);
    const omnix = connectionsResult(result.definitions, result.connections, result.lifecycles, OBSERVED_AT.toISOString());

    for (const lifecycle of result.lifecycles) {
      expect(connectionCardStatus(lifecycle)).toMatchObject({ status: 'ready', label: 'Connected · ready' });
      expect(readiness).toContainEqual({
        id: `connector-${lifecycle.provider}`, configured: true, status: lifecycle.state,
      });
      expect(omnix.answerBlocks[0]?.items).toContainEqual(expect.objectContaining({
        id: `connector-${lifecycle.provider}`, value: 'Ready', detail: lifecycle.safeSummary,
      }));
    }
  });

  it('does not let an optional audience-options failure contradict the canonical ready state', async () => {
    const result = await snapshot(readyReaders({
      readMailchimpAudiences: async () => {
        throw new ConnectorError('provider-retryable', 'provider options unavailable');
      },
    }));
    expect(result.mailchimp.lifecycle.state).toBe('ready');
    expect(connectionCardStatus(result.mailchimp.lifecycle)).toEqual({
      status: 'ready', label: 'Connected · ready',
    });
    expect(canShowMailchimpManagement(result.mailchimp.lifecycle)).toBe(true);
    expect(result.mailchimp.failures).toContainEqual(expect.objectContaining({ operation: 'audiences' }));
  });

  it('keeps the Mailchimp card and management surface aligned when audience authorization is forbidden', async () => {
    const result = await snapshot(readyReaders({
      readMailchimpAudiences: async () => {
        throw new ConnectorError('forbidden', 'provider rejected token');
      },
    }));
    const lifecycle = result.mailchimp.lifecycle;

    expect(lifecycle.state).toBe('reconnect-required');
    expect(connectionCardStatus(lifecycle)).toEqual({ status: 'review', label: 'Reconnect needed' });
    expect(canShowMailchimpManagement(lifecycle)).toBe(false);
    expect(canRecoverMailchimpLifecycle(lifecycle)).toBe(true);
  });

  it('keeps disabled providers Setup unavailable across Connections, readiness, and Omnix', async () => {
    const disabledDefinitions = definitions.map((definition) => ({ ...definition, enabled: false }));
    const result = await readConnectorLifecycleSnapshot({
      connectorRepository: {} as ConnectorRepository,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      isLive: false,
      definitions: disabledDefinitions,
      connections: [],
      observedAt: OBSERVED_AT,
    });
    const readiness = connectorLifecycleReadiness(result.lifecycles);
    const omnix = connectionsResult(disabledDefinitions, [], result.lifecycles, OBSERVED_AT.toISOString());

    for (const lifecycle of result.lifecycles) {
      expect(connectionCardStatus(lifecycle)).toEqual({ status: 'gated', label: SETUP_UNAVAILABLE_LABEL });
      expect(readiness).toContainEqual({
        id: `connector-${lifecycle.provider}`, configured: false, status: 'not-configured',
      });
      expect(omnix.answerBlocks[0]?.items).toContainEqual(expect.objectContaining({
        id: `connector-${lifecycle.provider}`, value: 'Unavailable',
        detail: 'This connection is not available yet.',
      }));
    }
  });
});
