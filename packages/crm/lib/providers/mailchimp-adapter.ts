import {
  ConnectorError,
  type ConnectorAdapter,
  type ConnectorAdapterResult,
  type ConnectorJob,
} from '../domain/connector.ts';
import type { MailchimpMemberOperation } from '../domain/mailchimp.ts';
import type { MailchimpMarketingClient } from './mailchimp-client.ts';
import type { ContactOutboundGuard } from '../data/contact-outbound-guard.ts';

export interface MailchimpJobAuthority {
  readonly operation: MailchimpMemberOperation;
  readonly client: Pick<MailchimpMarketingClient, 'setOmnixLeadTag' | 'listMemberTagNames'>;
}

export interface MailchimpJobAuthorityLoader {
  load(job: ConnectorJob): Promise<MailchimpJobAuthority>;
}

function mapProviderError(error: unknown): ConnectorAdapterResult {
    if (error instanceof ConnectorError) {
    if (error.code === 'forbidden') {
      return { outcome: 'terminal-failure', errorCategory: 'authorization_revoked' };
    }
    if (error.code === 'invalid-input' || error.code === 'conflict') {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
    if (error.code === 'configuration-required' || error.code === 'provider-disabled') {
      return { outcome: 'terminal-failure', errorCategory: 'configuration_required' };
    }
    if (error.code === 'provider-retryable') {
      return { outcome: 'retryable-failure', errorCategory: 'rate_limited' };
    }
  }
  return { outcome: 'unknown', errorCategory: 'network_outcome_unknown' };
}

export class MailchimpConnectorAdapter implements ConnectorAdapter {
  readonly provider = 'mailchimp' as const;

  constructor(private readonly authority: MailchimpJobAuthorityLoader, private readonly outboundGuard?: ContactOutboundGuard) {}

  async execute(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.provider !== 'mailchimp' || job.actionType !== 'audience.sync') {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
    try {
      const { operation, client } = await this.authority.load(job);
      if (!this.outboundGuard || !operation.contactId || !operation.contactPointId
        || operation.reviewedAliasEpoch === undefined) {
        throw new ConnectorError('configuration-required', 'Mailchimp outbound dispatch guard is required.');
      }
      const guard = this.outboundGuard;
      const contactId = operation.contactId!;
      const contactPointId = operation.contactPointId!;
      const reviewedAliasEpoch = operation.reviewedAliasEpoch!;
      try {
        await guard.assertTarget({ authenticatedUserId: job.leaseOwner!, ownerUserId: job.leaseOwner!,
          membershipId: job.leaseOwner!, workspaceId: job.workspaceId, role: 'owner', mode: 'live' },
        contactId, contactPointId, reviewedAliasEpoch);
      } catch {
        throw new ConnectorError('conflict', 'Mailchimp outbound target changed after review.');
      }
      await client.setOmnixLeadTag({
        audienceId: operation.audienceId,
        subscriberHash: operation.subscriberHash,
        tagName: operation.desiredTag,
      });
      return {
        outcome: 'succeeded',
        providerReceiptId: operation.operationKey,
        providerStatus: 'tag-active',
      };
    } catch (error) {
      return mapProviderError(error);
    }
  }

  async reconcile(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.provider !== 'mailchimp' || job.actionType !== 'audience.sync') {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
    try {
      const { operation, client } = await this.authority.load(job);
      const tags = await client.listMemberTagNames({
        audienceId: operation.audienceId,
        subscriberHash: operation.subscriberHash,
      });
      if (!tags.includes(operation.desiredTag)) {
        return { outcome: 'retryable-failure', errorCategory: 'network_not_sent' };
      }
      return {
        outcome: 'succeeded',
        providerReceiptId: operation.operationKey,
        providerStatus: 'tag-active-reconciled',
      };
    } catch (error) {
      return mapProviderError(error);
    }
  }

  /** Mailchimp account owners revoke the app in Authorized Apps; absence of an API is not confirmation. */
  async revoke(): Promise<ConnectorAdapterResult> {
    return {
      outcome: 'terminal-failure',
      errorCategory: 'configuration_required',
    };
  }
}
