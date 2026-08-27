import type {
  MailchimpCampaignContent,
  MailchimpCampaignRecord,
  MailchimpCampaignSegment,
} from '../domain/mailchimp-campaign.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface MailchimpCampaignRepository {
  list(scope: WorkspaceScope, limit?: number, offset?: number): Promise<readonly MailchimpCampaignRecord[]>;
  get(scope: WorkspaceScope, campaignId: string): Promise<MailchimpCampaignRecord | undefined>;
  createDraft(scope: WorkspaceScope, input: {
    readonly connectionId: string;
    readonly segment: MailchimpCampaignSegment;
    readonly content: MailchimpCampaignContent;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<MailchimpCampaignRecord>;
  updateDraft(scope: WorkspaceScope, input: {
    readonly campaignId: string;
    readonly version: number;
    readonly segment: MailchimpCampaignSegment;
    readonly content: MailchimpCampaignContent;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<MailchimpCampaignRecord>;
  approve(scope: WorkspaceScope, input: {
    readonly campaignId: string;
    readonly version: number;
    readonly action: 'create' | 'send';
    readonly contentHash: string;
    readonly recipientSnapshotHash: string;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<MailchimpCampaignRecord>;
  claimExecution(input: {
    readonly campaignId: string;
    readonly action: 'create' | 'send';
    readonly executionToken: string;
    readonly occurredAt: string;
  }): Promise<MailchimpCampaignRecord>;
  recordProviderResult(input: {
    readonly campaignId: string;
    readonly action: 'create' | 'send';
    readonly outcome: 'succeeded' | 'failed' | 'unknown';
    readonly providerCampaignId?: string;
    readonly providerStatus?: string;
    readonly errorCategory?: string;
    readonly requestHash: string;
    readonly correlationId: string;
    readonly occurredAt: string;
    readonly executionToken: string;
  }): Promise<MailchimpCampaignRecord>;
}
