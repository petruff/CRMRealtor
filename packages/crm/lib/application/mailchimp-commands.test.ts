import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMemoryConnectorRepository } from '@/lib/data/memory-connector-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import {
  listLiveMailchimpAudiencesCommand,
  listMailchimpAudiencesCommand,
  prepareMailchimpTagSyncIntentCommand,
  probeLiveMailchimpConnectionCommand,
  previewMailchimpTagSyncCommand,
  reconcileMailchimpBaselinePageCommand,
  selectMailchimpAudienceCommand,
  setupMailchimpSignedWebhookCommand,
} from './mailchimp-commands';
import { createMailchimpMemberOperation } from '@/lib/domain/mailchimp';
import type { MailchimpOperationRepository, MailchimpSetupRepository } from '@/lib/data/mailchimp-operation-repository';
import type { WorkspaceScope } from '@/lib/domain/workspace';

const enabledConfiguration = {
  ...loadConnectorRuntimeConfiguration({}),
  definitions: loadConnectorRuntimeConfiguration({}).definitions.map((definition) => definition.provider === 'mailchimp'
    ? { ...definition, mode: 'live' as const, enabled: true }
    : definition),
};

const repository = createMemoryConnectorRepository({
  definitions: enabledConfiguration.definitions,
  initialConnections: [{
    id: 'mailchimp-a', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
    provider: 'mailchimp', remoteAccountId: 'account-hash', grantedScopes: ['audience.sync'],
    status: 'active', connectedAt: '2026-08-11T12:00:00Z', updatedAt: '2026-08-11T12:00:00Z',
  }],
});
const liveScope: WorkspaceScope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' };
const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 4) };

function operationRepository(): MailchimpOperationRepository {
  const operation = createMailchimpMemberOperation({
    audienceId: 'audience-a', normalizedEmail: 'buyer@example.com', leadType: 'hot',
  });
  return {
    readConnectionAuthority: vi.fn(async () => ({
      workspaceId: liveScope.workspaceId, connectionId: 'mailchimp-a', accountIdHash: 'a'.repeat(64),
      dataCenter: 'us21', secretVersion: 1, grantedScopes: ['audience.sync', 'audience.reconcile'],
      accessTokenEnvelope: (await import('@/lib/security/connector-secret-envelope')).encryptConnectorSecret('token-a', {
        workspaceId: liveScope.workspaceId, connectionId: 'mailchimp-a', provider: 'mailchimp',
        secretType: 'mailchimp-access-token', recordVersion: 1,
      }, resolver),
    })),
    getSelectedAudience: vi.fn(async () => ({
      id: 'binding-a',
      connectionId: 'mailchimp-a', accountIdHash: 'a'.repeat(64), dataCenter: 'us21',
      audienceId: 'audience-a', audienceName: 'Primary', mappingVersion: 1, selectedAt: '2026-08-11T12:00:00Z',
    })),
    hasLinkedMember: vi.fn(async () => true),
    selectAudience: vi.fn(),
    ensureSyncPolicy: vi.fn(async () => ({ id: 'policy-a', version: 1, noOp: true })),
    storeOperation: vi.fn(async () => ({
      payloadReference: 'payload-a', payloadHash: operation.operationKey, envelopeVersion: 1,
    })),
    recordProbe: vi.fn(async (_scope, input) => ({ status: input.status, occurredAt: input.occurredAt, noOp: false })),
  };
}

function setupRepository(): MailchimpSetupRepository {
  return {
    ...operationRepository(),
    readSetupState: vi.fn(async () => ({
      workspaceId: liveScope.workspaceId, connectionId: 'mailchimp-a',
      webhookRegistrationRequired: true, endpointBound: false,
    })),
    bindSigningSecret: vi.fn(async () => ({ secretVersion: 1, noOp: false })),
    applyBaselineMember: vi.fn(async () => ({ outcome: 'applied', noOp: false })),
    completeBaseline: vi.fn(async () => ({ noOp: false })),
  };
}

describe('Mailchimp CLI-first application commands', () => {
  it('fails closed before provider calls while Mailchimp is disabled', async () => {
    const client = { listAudiences: vi.fn() };
    await expect(listMailchimpAudiencesCommand(
      repository, client, loadConnectorRuntimeConfiguration({}), SAMPLE_WORKSPACE_SCOPE,
      { connectionId: 'mailchimp-a' },
    )).rejects.toMatchObject({ code: 'provider-disabled' });
    expect(client.listAudiences).not.toHaveBeenCalled();
  });

  it('lists bounded audiences only from the workspace-bound connection', async () => {
    const client = { listAudiences: vi.fn(async () => [{ id: 'audience-a', name: 'Primary', memberCount: 200 }]) };
    await expect(listMailchimpAudiencesCommand(
      repository, client, enabledConfiguration, SAMPLE_WORKSPACE_SCOPE,
      { connectionId: 'mailchimp-a', limit: 20 },
    )).resolves.toEqual([{ id: 'audience-a', name: 'Primary', memberCount: 200 }]);
    expect(client.listAudiences).toHaveBeenCalledWith(20);
  });

  it('does not let support authority select or inspect a Mailchimp audience', async () => {
    const client = { listAudiences: vi.fn() };
    const supportScope: WorkspaceScope = {
      ...liveScope,
      authenticatedUserId: 'support-user',
      membershipId: 'support-membership',
      role: 'assistant',
      supportGrant: { active: true },
    };
    await expect(listMailchimpAudiencesCommand(
      repository, client, enabledConfiguration, supportScope, { connectionId: 'mailchimp-a' },
    )).rejects.toMatchObject({ code: 'forbidden' });
    expect(() => selectMailchimpAudienceCommand(supportScope, {
      connectionId: 'mailchimp-a', accountIdHash: 'a'.repeat(64), dataCenter: 'us21',
      audience: { id: 'audience-a', name: 'Primary clients', memberCount: 200 },
    })).toThrow(/owner/i);
    expect(client.listAudiences).not.toHaveBeenCalled();
  });

  it('selects one audience and creates a count-only, email-free preview', () => {
    const binding = selectMailchimpAudienceCommand(SAMPLE_WORKSPACE_SCOPE, {
      connectionId: 'mailchimp-a', accountIdHash: 'a'.repeat(64), dataCenter: 'us21',
      audience: { id: 'audience-a', name: 'Primary clients', memberCount: 200 },
    }, new Date('2026-08-11T12:00:00Z'));
    const preview = previewMailchimpTagSyncCommand({ binding, contacts: [
      { normalizedEmail: 'buyer@example.com', leadType: 'hot' },
      { normalizedEmail: 'seller@example.com', leadType: 'nurture' },
    ] });
    expect(preview).toMatchObject({ count: 2, mappingVersion: 1, containsRawEmails: false });
    expect(JSON.stringify(preview)).not.toMatch(/buyer@example|seller@example/);
  });

  it('decrypts a server-only token to list audiences without returning credentials', async () => {
    const operations = operationRepository();
    const createClient = vi.fn(() => ({
      listAudiences: vi.fn(async () => [{ id: 'audience-a', name: 'Primary', memberCount: 5 }]),
    }));
    const result = await listLiveMailchimpAudiencesCommand(
      operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', limit: 20 }, { resolver, createClient },
    );
    expect(result).toEqual([{ id: 'audience-a', name: 'Primary', memberCount: 5 }]);
    expect(createClient).toHaveBeenCalledWith('us21', 'token-a');
    expect(JSON.stringify(result)).not.toContain('token-a');
  });

  it('runs a real read-only probe and persists success or authorization failure without credentials', async () => {
    const operations = operationRepository();
    const success = await probeLiveMailchimpConnectionCommand(
      operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', correlationId: 'correlation-a' },
      { resolver, createClient: () => ({ listAudiences: vi.fn(), ping: vi.fn(async () => undefined) }) },
      new Date('2026-08-11T12:00:00.000Z'),
    );
    expect(success).toEqual({
      connectionId: 'mailchimp-a', healthy: true, status: 'active', probedAt: '2026-08-11T12:00:00.000Z',
    });
    expect(operations.recordProbe).toHaveBeenCalledWith(liveScope, expect.objectContaining({
      status: 'active', accountIdHash: 'a'.repeat(64),
      grantedScopes: ['audience.sync', 'audience.reconcile'], errorCategory: 'none',
    }));

    const revoked = operationRepository();
    const failed = await probeLiveMailchimpConnectionCommand(
      revoked, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', correlationId: 'correlation-b' },
      { resolver, createClient: () => ({
        listAudiences: vi.fn(),
        ping: vi.fn(async () => { throw new (await import('@/lib/domain/connector')).ConnectorError('forbidden', '401'); }),
      }) },
      new Date('2026-08-11T12:01:00.000Z'),
    );
    expect(failed).toMatchObject({ healthy: false, status: 'reauthorization-required', errorCategory: 'authorization_revoked' });
    expect(JSON.stringify(failed)).not.toContain('token-a');
  });

  it('stores one encrypted linked-member operation before creating its governed intent', async () => {
    const operations = operationRepository();
    const intent = await prepareMailchimpTagSyncIntentCommand(
      repository, operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', contactId: 'contact-a', contactPointId: 'point-a',
        normalizedEmail: 'buyer@example.com', leadType: 'hot', correlationId: 'correlation-a' },
      { resolver, outboundGuard: { assertTarget: vi.fn(async () => ({ contactId: 'contact-a',
        contactPointId: 'point-a', aliasEpoch: 6 })) } }, new Date('2026-08-11T12:00:00Z'),
    );
    expect(intent).toMatchObject({ provider: 'mailchimp', actionType: 'audience.sync', payloadReference: 'payload-a' });
    expect(operations.hasLinkedMember).toHaveBeenCalledWith(liveScope, expect.objectContaining({
      connectionId: 'mailchimp-a', subscriberHash: expect.stringMatching(/^[a-f0-9]{32}$/),
    }));
    expect(operations.storeOperation).toHaveBeenCalledWith(liveScope, expect.objectContaining({
      connectionId: 'mailchimp-a', envelope: expect.not.objectContaining({ ciphertext: expect.stringContaining('buyer@example') }),
    }));
  });

  it('registers a selected-audience webhook without returning its endpoint or signing secret', async () => {
    const operations = setupRepository();
    const result = await setupMailchimpSignedWebhookCommand(
      operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', webhookBaseUrl: 'https://crm.example.com/api/connectors/mailchimp/webhook', correlationId: 'correlation-a' },
      { resolver, createEndpointKey: () => 'opaque'.repeat(8), createClient: () => ({
        listAudiences: vi.fn(), listAudienceMembers: vi.fn(),
        createSignedAudienceWebhook: vi.fn(async () => ({ webhookId: 'webhook-a', signingSecret: 'secret-a' })),
        deleteAudienceWebhook: vi.fn(),
      }) },
      new Date('2026-08-11T12:00:00.000Z'),
    );
    expect(result).toMatchObject({ ready: true, secretVersion: 1 });
    expect(JSON.stringify(result)).not.toMatch(/opaque|secret-a|webhook-a/);
    expect(operations.bindSigningSecret).toHaveBeenCalledWith(expect.objectContaining({
      endpointKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      webhookIdHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it('deletes the provider webhook when encrypted authority persistence fails', async () => {
    const operations = setupRepository();
    operations.bindSigningSecret = vi.fn(async () => { throw new Error('database unavailable'); });
    const deleteAudienceWebhook = vi.fn(async () => undefined);
    await expect(setupMailchimpSignedWebhookCommand(
      operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', webhookBaseUrl: 'https://crm.example.com/api/connectors/mailchimp/webhook', correlationId: 'correlation-a' },
      { resolver, createEndpointKey: () => 'opaque'.repeat(8), createClient: () => ({
        listAudiences: vi.fn(), listAudienceMembers: vi.fn(),
        createSignedAudienceWebhook: vi.fn(async () => ({ webhookId: 'webhook-a', signingSecret: 'secret-a' })),
        deleteAudienceWebhook,
      }) },
      new Date('2026-08-11T12:00:00.000Z'),
    )).rejects.toThrow(/database unavailable/i);
    expect(deleteAudienceWebhook).toHaveBeenCalledWith({ audienceId: 'audience-a', webhookId: 'webhook-a' });
  });

  it('fails closed with manual cleanup guidance when orphan compensation cannot be confirmed', async () => {
    const operations = setupRepository();
    operations.bindSigningSecret = vi.fn(async () => { throw new Error('database unavailable'); });
    await expect(setupMailchimpSignedWebhookCommand(
      operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', webhookBaseUrl: 'https://crm.example.com/api/connectors/mailchimp/webhook', correlationId: 'correlation-a' },
      { resolver, createEndpointKey: () => 'opaque'.repeat(8), createClient: () => ({
        listAudiences: vi.fn(), listAudienceMembers: vi.fn(),
        createSignedAudienceWebhook: vi.fn(async () => ({ webhookId: 'webhook-a', signingSecret: 'secret-a' })),
        deleteAudienceWebhook: vi.fn(async () => { throw new Error('provider unavailable'); }),
      }) },
      new Date('2026-08-11T12:00:00.000Z'),
    )).rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/remove the webhook/i) });
  });

  it('applies a bounded baseline page and only completes on the final page', async () => {
    const operations = setupRepository();
    const member = createMailchimpMemberOperation({
      audienceId: 'audience-a', normalizedEmail: 'buyer@example.com', leadType: 'hot',
    });
    const result = await reconcileMailchimpBaselinePageCommand(
      operations, enabledConfiguration, liveScope,
      { connectionId: 'mailchimp-a', offset: 0, limit: 100, correlationId: 'correlation-a' },
      { resolver, createClient: () => ({
        listAudiences: vi.fn(), createSignedAudienceWebhook: vi.fn(), deleteAudienceWebhook: vi.fn(),
        listAudienceMembers: vi.fn(async () => ({ totalItems: 1, members: [{
          memberId: 'member-a', subscriberHash: member.subscriberHash,
          normalizedEmail: 'buyer@example.com', subscriptionStatus: 'unsubscribed' as const,
          lastChangedAt: '2026-08-11T11:00:00.000Z',
        }] })),
      }) },
      new Date('2026-08-11T12:00:00.000Z'),
    );
    expect(result).toMatchObject({ processed: 1, totalItems: 1, complete: true, outcomes: { applied: 1 } });
    expect(operations.completeBaseline).toHaveBeenCalledOnce();
  });
});
