import { describe, expect, it, vi } from 'vitest';
import { loadConnectorRuntimeConfiguration } from '@/lib/config/connector-runtime';
import type { MailchimpCampaignRepository } from '@/lib/data/mailchimp-campaign-repository';
import type { MailchimpOperationRepository } from '@/lib/data/mailchimp-operation-repository';
import type { MailchimpCampaignRecord } from '@/lib/domain/mailchimp-campaign';
import type { WorkspaceScope } from '@/lib/domain/workspace';
import { ConnectorError } from '@/lib/domain/connector';
import { encryptConnectorSecret } from '@/lib/security/connector-secret-envelope';
import { executeMailchimpCampaignActionCommand, updateMailchimpCampaignDraftCommand } from './mailchimp-campaign-service';

const scope: WorkspaceScope = {
  mode: 'live', workspaceId: '11111111-1111-4111-8111-111111111111', role: 'owner',
  authenticatedUserId: 'owner-a', ownerUserId: 'owner-a',
  membershipId: '22222222-2222-4222-8222-222222222222',
};
const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 7) };
const configuration = {
  ...loadConnectorRuntimeConfiguration({}),
  definitions: loadConnectorRuntimeConfiguration({}).definitions.map((definition) => definition.provider === 'mailchimp'
    ? { ...definition, mode: 'live' as const, enabled: true }
    : definition),
};
const content = { title: 'August update', subject: 'Market update', previewText: 'A useful update',
  fromName: 'Judith Serna', replyTo: 'judith@example.com', html: '<p>Hello</p>', plainText: 'Hello' };

function campaign(state: MailchimpCampaignRecord['state'], remoteCampaignId?: string): MailchimpCampaignRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333', workspaceId: scope.workspaceId,
    connectionId: '44444444-4444-4444-8444-444444444444',
    bindingId: '55555555-5555-4555-8555-555555555555', version: 1, state,
    segment: { kind: 'all-subscribers' }, content, contentHash: 'a'.repeat(64),
    recipientSnapshotHash: 'b'.repeat(64), eligibleCount: 25,
    excluded: { unsubscribed: 2, nonSubscribed: 0, cleaned: 0, pending: 0, archived: 0, duplicate: 0, invalid: 0 },
    ...(remoteCampaignId ? { remoteCampaignId } : {}),
    createdAt: '2026-08-27T12:00:00.000Z', updatedAt: '2026-08-27T12:00:00.000Z',
  };
}

function repositories(record: MailchimpCampaignRecord) {
  const campaigns: MailchimpCampaignRepository = {
    list: vi.fn(), get: vi.fn(async () => record), createDraft: vi.fn(), updateDraft: vi.fn(),
    approve: vi.fn(async () => ({ ...record,
      state: (record.state === 'draft' ? 'create_approved' : 'send_approved') as MailchimpCampaignRecord['state'] })),
    claimExecution: vi.fn(async () => record),
    recordProviderResult: vi.fn(async (input) => ({ ...record,
      state: input.outcome === 'succeeded' ? (input.action === 'create' ? 'created' : 'sent') : record.state,
      ...(input.providerCampaignId ? { remoteCampaignId: input.providerCampaignId } : {}),
    })),
  };
  const operations: MailchimpOperationRepository = {
    readConnectionAuthority: vi.fn(async () => ({
      workspaceId: scope.workspaceId, connectionId: record.connectionId, accountIdHash: 'c'.repeat(64),
      dataCenter: 'us21', secretVersion: 1, grantedScopes: ['audience.sync'],
      accessTokenEnvelope: encryptConnectorSecret('token-a', {
        workspaceId: scope.workspaceId, connectionId: record.connectionId, provider: 'mailchimp',
        secretType: 'mailchimp-access-token', recordVersion: 1,
      }, resolver),
    })),
    getSelectedAudience: vi.fn(async () => ({ id: record.bindingId, connectionId: record.connectionId,
      accountIdHash: 'c'.repeat(64), dataCenter: 'us21', audienceId: 'audience-a', audienceName: 'Primary',
      mappingVersion: 1, selectedAt: '2026-08-27T11:00:00.000Z' })),
    hasLinkedMember: vi.fn(async () => true),
    selectAudience: vi.fn(),
    ensureSyncPolicy: vi.fn(async () => ({ id: 'policy-a', version: 1, noOp: true })),
    storeOperation: vi.fn(async () => ({ payloadReference: 'payload-a', payloadHash: 'd'.repeat(64), envelopeVersion: 1 })),
    recordProbe: vi.fn(async (_scope, input) => ({ status: input.status, occurredAt: input.occurredAt, noOp: false })),
  };
  return { campaigns, operations };
}

describe('governed Mailchimp campaign service', () => {
  it('recovers an interrupted provider draft by its exact Omnix title without creating a duplicate', async () => {
    const record = campaign('create_approved');
    const repositoriesValue = repositories(record);
    const client = {
      findCampaignDraft: vi.fn(async () => ({ campaignId: 'remote-recovered' })),
      createCampaignDraft: vi.fn(), setCampaignContent: vi.fn(), readCampaignStatus: vi.fn(),
      readCampaignSendChecklist: vi.fn(), sendCampaign: vi.fn(),
    };
    await executeMailchimpCampaignActionCommand({ ...repositoriesValue, configuration, scope,
      campaignId: record.id, action: 'create', correlationId: '66666666-6666-4666-8666-666666666666',
      resolver, createClient: () => client });
    expect(repositoriesValue.campaigns.approve).not.toHaveBeenCalled();
    expect(repositoriesValue.campaigns.claimExecution).toHaveBeenCalledOnce();
    expect(client.createCampaignDraft).not.toHaveBeenCalled();
    expect(client.setCampaignContent).toHaveBeenCalledWith({ campaignId: 'remote-recovered', content });
    expect(repositoriesValue.campaigns.recordProviderResult).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', outcome: 'succeeded', providerCampaignId: 'remote-recovered' }),
    );
  });

  it('reconciles a provider-confirmed send without sending twice', async () => {
    const record = campaign('send_approved', 'remote-a');
    const repositoriesValue = repositories(record);
    const client = { findCampaignDraft: vi.fn(), createCampaignDraft: vi.fn(), setCampaignContent: vi.fn(),
      readCampaignStatus: vi.fn(async () => 'sent' as const), readCampaignSendChecklist: vi.fn(), sendCampaign: vi.fn() };
    await executeMailchimpCampaignActionCommand({ ...repositoriesValue, configuration, scope,
      campaignId: record.id, action: 'send', correlationId: '77777777-7777-4777-8777-777777777777',
      resolver, createClient: () => client });
    expect(client.sendCampaign).not.toHaveBeenCalled();
    expect(repositoriesValue.campaigns.recordProviderResult).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send', outcome: 'succeeded', providerCampaignId: 'remote-a' }),
    );
  });

  it('keeps retryable provider failures in an unknown reconciliable state', async () => {
    const record = campaign('send_approved', 'remote-a');
    const repositoriesValue = repositories(record);
    const client = { findCampaignDraft: vi.fn(), createCampaignDraft: vi.fn(), setCampaignContent: vi.fn(),
      readCampaignStatus: vi.fn(async () => 'save' as const), readCampaignSendChecklist: vi.fn(async () => ({ ready: true, issues: [] })),
      sendCampaign: vi.fn(async () => { throw new ConnectorError('provider-retryable', 'Provider timeout.'); }) };
    await expect(executeMailchimpCampaignActionCommand({ ...repositoriesValue, configuration, scope,
      campaignId: record.id, action: 'send', correlationId: '88888888-8888-4888-8888-888888888888',
      resolver, createClient: () => client })).rejects.toMatchObject({ code: 'provider-retryable' });
    expect(repositoriesValue.campaigns.recordProviderResult).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send', outcome: 'unknown', providerCampaignId: 'remote-a' }),
    );
  });

  it('rejects invalid optimistic-lock versions before persistence', async () => {
    const repository = repositories(campaign('draft')).campaigns;
    await expect(updateMailchimpCampaignDraftCommand({ repository, scope,
      campaignId: 'campaign-a', version: Number.NaN, segment: { kind: 'all-subscribers' }, content,
      correlationId: '99999999-9999-4999-8999-999999999999' }))
      .rejects.toMatchObject({ code: 'invalid-input' });
    expect(repository.updateDraft).not.toHaveBeenCalled();
  });
});
