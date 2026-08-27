import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type { MailchimpCampaignRepository } from '../data/mailchimp-campaign-repository.ts';
import type { MailchimpOperationRepository } from '../data/mailchimp-operation-repository.ts';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import {
  parseMailchimpCampaignContent,
  parseMailchimpCampaignSegment,
  mailchimpProviderCampaignTitle,
  type MailchimpCampaignContent,
  type MailchimpCampaignSegment,
} from '../domain/mailchimp-campaign.ts';
import { isCanonicalWorkspaceOwnerScope, validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret, type ConnectorKekResolver } from '../security/connector-secret-envelope.ts';

export interface MailchimpCampaignProvider {
  createCampaignDraft(input: {
    readonly audienceId: string;
    readonly segment: MailchimpCampaignSegment;
    readonly content: MailchimpCampaignContent;
  }): Promise<{ readonly campaignId: string }>;
  setCampaignContent(input: { readonly campaignId: string; readonly content: MailchimpCampaignContent }): Promise<void>;
  findCampaignDraft(input: {
    readonly audienceId: string;
    readonly providerTitle: string;
    readonly createdSince: string;
  }): Promise<{ readonly campaignId: string } | undefined>;
  readCampaignStatus(campaignId: string): Promise<'save' | 'paused' | 'schedule' | 'sending' | 'sent'>;
  readCampaignSendChecklist(campaignId: string): Promise<{ readonly ready: boolean; readonly issues: readonly string[] }>;
  sendCampaign(campaignId: string): Promise<void>;
}

function enabled(configuration: ConnectorRuntimeConfiguration): void {
  const definition = configuration.definitions.find((item) => item.provider === 'mailchimp');
  if (!definition?.enabled || !['uat', 'live'].includes(definition.mode)) {
    throw new ConnectorError('provider-disabled', 'Mailchimp campaigns are not enabled in this deployment.');
  }
}

function errorCategory(error: unknown): string {
  if (error instanceof ConnectorError) {
    return ({ forbidden: 'authorization_revoked', conflict: 'campaign_conflict',
      'invalid-input': 'campaign_invalid', 'provider-disabled': 'provider_unavailable',
      'provider-retryable': 'provider_retryable', 'configuration-required': 'configuration_required',
      'not-found': 'not_found' } as Record<string, string>)[error.code]
      ?? 'internal_error';
  }
  return 'internal_error';
}

export async function createMailchimpCampaignDraftCommand(input: {
  readonly repository: MailchimpCampaignRepository;
  readonly scope: WorkspaceScope;
  readonly connectionId: string;
  readonly segment: MailchimpCampaignSegment;
  readonly content: MailchimpCampaignContent;
  readonly correlationId: string;
  readonly now?: Date;
}) {
  const scope = validateWorkspaceScope(input.scope);
  if (scope.mode !== 'live') throw new ConnectorError('forbidden', 'Live workspace access is required.');
  const segment = parseMailchimpCampaignSegment(input.segment);
  const content = parseMailchimpCampaignContent(input.content);
  return input.repository.createDraft(scope, {
    connectionId: input.connectionId, segment, content, correlationId: input.correlationId,
    occurredAt: (input.now ?? new Date()).toISOString(),
  });
}

export async function updateMailchimpCampaignDraftCommand(input: {
  readonly repository: MailchimpCampaignRepository;
  readonly scope: WorkspaceScope;
  readonly campaignId: string;
  readonly version: number;
  readonly segment: MailchimpCampaignSegment;
  readonly content: MailchimpCampaignContent;
  readonly correlationId: string;
  readonly now?: Date;
}) {
  const scope = validateWorkspaceScope(input.scope);
  if (scope.mode !== 'live') throw new ConnectorError('forbidden', 'Live workspace access is required.');
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new ConnectorError('invalid-input', 'Campaign version is invalid.');
  }
  return input.repository.updateDraft(scope, {
    campaignId: input.campaignId,
    version: input.version,
    segment: parseMailchimpCampaignSegment(input.segment),
    content: parseMailchimpCampaignContent(input.content),
    correlationId: input.correlationId,
    occurredAt: (input.now ?? new Date()).toISOString(),
  });
}

export async function executeMailchimpCampaignActionCommand(input: {
  readonly campaigns: MailchimpCampaignRepository;
  readonly operations: MailchimpOperationRepository;
  readonly configuration: ConnectorRuntimeConfiguration;
  readonly scope: WorkspaceScope;
  readonly campaignId: string;
  readonly action: 'create' | 'send';
  readonly correlationId: string;
  readonly resolver?: ConnectorKekResolver;
  readonly createClient: (dataCenter: string, token: string) => MailchimpCampaignProvider;
  readonly now?: Date;
}) {
  const scope = validateWorkspaceScope(input.scope);
  enabled(input.configuration);
  if (scope.mode !== 'live' || !isCanonicalWorkspaceOwnerScope(scope)) {
    throw new ConnectorError('forbidden', 'Only the workspace owner can approve or send a campaign.');
  }
  const campaign = await input.campaigns.get(scope, input.campaignId);
  if (!campaign) throw new ConnectorError('not-found', 'Campaign was not found.');
  const authority = await input.operations.readConnectionAuthority(scope, campaign.connectionId);
  const binding = await input.operations.getSelectedAudience(scope, campaign.connectionId);
  if (!binding || binding.id !== campaign.bindingId) {
    throw new ConnectorError('conflict', 'The selected Mailchimp audience changed. Create a new campaign draft.');
  }
  const token = decryptConnectorSecret(authority.accessTokenEnvelope, {
    workspaceId: scope.workspaceId, connectionId: campaign.connectionId, provider: 'mailchimp',
    secretType: 'mailchimp-access-token', recordVersion: authority.secretVersion,
  }, input.resolver ?? createEnvironmentKekResolver());
  const client = input.createClient(authority.dataCenter, token);
  const approvedState = input.action === 'create' ? 'create_approved' : 'send_approved';
  if (campaign.state !== approvedState) {
    await input.campaigns.approve(scope, {
      campaignId: campaign.id, version: campaign.version, action: input.action,
      contentHash: campaign.contentHash, recipientSnapshotHash: campaign.recipientSnapshotHash,
      correlationId: input.correlationId, occurredAt: (input.now ?? new Date()).toISOString(),
    });
  }
  const requestHash = stablePayloadHash({ campaignId: campaign.id, action: input.action,
    contentHash: campaign.contentHash, recipientSnapshotHash: campaign.recipientSnapshotHash });
  await input.campaigns.claimExecution({ campaignId: campaign.id, action: input.action,
    executionToken: input.correlationId, occurredAt: (input.now ?? new Date()).toISOString() });
  let remoteCampaignId = campaign.remoteCampaignId;
  let providerActionCompleted = false;
  try {
    if (input.action === 'create') {
      const providerContent = { ...campaign.content, title: mailchimpProviderCampaignTitle(campaign) };
      if (!remoteCampaignId) {
        const recovered = await client.findCampaignDraft({
          audienceId: binding.audienceId,
          providerTitle: providerContent.title,
          createdSince: campaign.createdAt,
        });
        const remote = recovered ?? await client.createCampaignDraft({
          audienceId: binding.audienceId, segment: campaign.segment, content: providerContent,
        });
        remoteCampaignId = remote.campaignId;
      }
      await client.setCampaignContent({ campaignId: remoteCampaignId, content: campaign.content });
      providerActionCompleted = true;
    } else {
      if (!remoteCampaignId) throw new ConnectorError('conflict', 'Mailchimp campaign draft is missing.');
      const status = await client.readCampaignStatus(remoteCampaignId);
      if (status === 'sent' || status === 'sending') {
        providerActionCompleted = true;
      } else {
        if (status !== 'save') {
          throw new ConnectorError('conflict', `Mailchimp campaign status changed to ${status}. Review it in Mailchimp before continuing.`);
        }
        const checklist = await client.readCampaignSendChecklist(remoteCampaignId);
        if (!checklist.ready) {
          throw new ConnectorError('conflict', `Mailchimp needs attention before sending: ${checklist.issues.slice(0, 3).join('; ')}`);
        }
        await client.sendCampaign(remoteCampaignId);
        providerActionCompleted = true;
      }
    }
    return await input.campaigns.recordProviderResult({
      campaignId: campaign.id, action: input.action, outcome: 'succeeded',
      providerCampaignId: remoteCampaignId, providerStatus: input.action === 'create' ? 'save' : 'sent',
      requestHash, correlationId: input.correlationId, occurredAt: (input.now ?? new Date()).toISOString(),
      executionToken: input.correlationId,
    });
  } catch (error) {
    await input.campaigns.recordProviderResult({
      campaignId: campaign.id, action: input.action,
      outcome: providerActionCompleted || remoteCampaignId || error instanceof ConnectorError && error.code === 'provider-retryable'
        ? 'unknown' : 'failed',
      ...(remoteCampaignId ? { providerCampaignId: remoteCampaignId } : {}),
      errorCategory: errorCategory(error), requestHash, correlationId: input.correlationId,
      occurredAt: (input.now ?? new Date()).toISOString(),
      executionToken: input.correlationId,
    });
    throw error;
  }
}
