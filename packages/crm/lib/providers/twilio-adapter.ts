import {
  ConnectorError,
  stablePayloadHash,
  type ConnectorAdapter,
  type ConnectorAdapterResult,
  type ConnectorJob,
} from '../domain/connector.ts';
import { evaluateTextingQuietHours, parseE164Phone, parseTextMessageBody } from '../domain/texting.ts';
import type { TwilioMessagingClient } from './twilio-client.ts';
import type { ContactOutboundGuard } from '../data/contact-outbound-guard.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface TwilioApprovedSendOperation {
  readonly kind: 'message.send';
  readonly messageId: string;
  readonly contactId: string;
  readonly contactPointId: string;
  readonly to: string;
  readonly body: string;
  readonly consentEvidenceId: string;
  readonly consentVersion: number;
  readonly useCase: string;
  readonly policyVersion: string;
  readonly recipientTimeZone: string;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly idempotencyKey: string;
  readonly approvedAt: string;
  readonly reviewedAliasEpoch: number;
}

export interface TwilioApprovedLookupOperation {
  readonly kind: 'message.lookup';
  readonly messageId: string;
  readonly providerMessageSid: string;
}

export interface TwilioJobAuthority {
  readonly operation: TwilioApprovedSendOperation | TwilioApprovedLookupOperation;
  readonly client: Pick<TwilioMessagingClient, 'sendMessage' | 'getMessage' | 'findApprovedMessage'>;
  bind(input: {
    readonly messageId: string;
    readonly messageSid: string;
    readonly status: string;
    readonly operationHash: string;
  }): Promise<void>;
}

export interface TwilioJobAuthorityLoader {
  load(job: ConnectorJob): Promise<TwilioJobAuthority>;
}

function providerError(error: unknown): ConnectorAdapterResult {
  if (error instanceof ConnectorError) {
    if (error.code === 'forbidden') return { outcome: 'terminal-failure', errorCategory: 'authorization_revoked' };
    if (error.code === 'invalid-input' || error.code === 'conflict') {
      return { outcome: 'terminal-failure', errorCategory: 'compliance_blocked' };
    }
    if (error.code === 'configuration-required' || error.code === 'provider-disabled') {
      return { outcome: 'terminal-failure', errorCategory: 'configuration_required' };
    }
    if (error.code === 'provider-retryable') return { outcome: 'retryable-failure', errorCategory: 'rate_limited' };
  }
  return { outcome: 'unknown', errorCategory: 'network_outcome_unknown' };
}

function validateOperation(operation: TwilioApprovedSendOperation, now: Date): void {
  parseE164Phone(operation.to);
  parseTextMessageBody(operation.body);
  if (operation.kind !== 'message.send'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(operation.messageId)
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(operation.idempotencyKey)
    || !Number.isInteger(operation.consentVersion) || operation.consentVersion < 1
    || !Number.isFinite(new Date(operation.approvedAt).getTime())) {
    throw new ConnectorError('invalid-input', 'Approved texting operation is invalid.');
  }
  const quietHours = evaluateTextingQuietHours({
    startLocal: operation.quietHoursStart,
    endLocal: operation.quietHoursEnd,
    recipientTimeZone: operation.recipientTimeZone,
    policyVersion: operation.policyVersion,
  }, now);
  if (!quietHours.allowed) throw new ConnectorError('conflict', 'Approved texting operation is inside quiet hours.');
}

export class TwilioConnectorAdapter implements ConnectorAdapter {
  readonly provider = 'twilio' as const;

  constructor(
    private readonly authority: TwilioJobAuthorityLoader,
    private readonly now: () => Date = () => new Date(),
    private readonly outboundGuard?: ContactOutboundGuard,
  ) {}

  async execute(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.provider !== 'twilio' || job.actionType !== 'message.send') {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
    try {
      const authority = await this.authority.load(job);
      if (authority.operation.kind === 'message.lookup') {
        const existing = await authority.client.getMessage(authority.operation.providerMessageSid);
        if (!existing) return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
        await authority.bind({ messageId: authority.operation.messageId, messageSid: existing.messageSid,
          status: existing.status, operationHash: stablePayloadHash(authority.operation) });
        return { outcome: 'succeeded', providerReceiptId: existing.messageSid, providerStatus: existing.status };
      }
      validateOperation(authority.operation, this.now());
      if (!this.outboundGuard) throw new ConnectorError('configuration-required', 'Twilio outbound dispatch guard is required.');
      const operation = authority.operation as TwilioApprovedSendOperation;
      const guard = this.outboundGuard;
      try {
        await guard.assertTarget({
          authenticatedUserId: job.leaseOwner!, ownerUserId: job.leaseOwner!, membershipId: job.leaseOwner!,
          workspaceId: job.workspaceId, role: 'owner', mode: 'live',
        } satisfies WorkspaceScope, operation.contactId, operation.contactPointId, operation.reviewedAliasEpoch);
      } catch {
        throw new ConnectorError('conflict', 'Twilio outbound target changed after review.');
      }
      const result = await authority.client.sendMessage({
        to: authority.operation.to,
        body: authority.operation.body,
        idempotencyKey: authority.operation.idempotencyKey,
      });
      await authority.bind({
        messageId: authority.operation.messageId,
        messageSid: result.messageSid,
        status: result.status,
        operationHash: stablePayloadHash(authority.operation),
      });
      return { outcome: 'succeeded', providerReceiptId: result.messageSid, providerStatus: result.status };
    } catch (error) {
      return providerError(error);
    }
  }

  async reconcile(job: ConnectorJob): Promise<ConnectorAdapterResult> {
    if (job.provider !== 'twilio' || job.actionType !== 'message.send') {
      return { outcome: 'terminal-failure', errorCategory: 'validation_failed' };
    }
    try {
      const authority = await this.authority.load(job);
      if (authority.operation.kind === 'message.lookup') {
        const result = await authority.client.getMessage(authority.operation.providerMessageSid);
        if (!result) return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
        await authority.bind({ messageId: authority.operation.messageId, messageSid: result.messageSid,
          status: result.status, operationHash: stablePayloadHash(authority.operation) });
        return { outcome: 'succeeded', providerReceiptId: result.messageSid, providerStatus: result.status };
      }
      validateOperation(authority.operation, this.now());
      const recovered = await authority.client.findApprovedMessage({
        to: authority.operation.to,
        body: authority.operation.body,
        attemptedAt: job.updatedAt,
      });
      if (!recovered) return { outcome: 'unknown', errorCategory: 'provider_acceptance_unknown' };
      await authority.bind({
        messageId: authority.operation.messageId,
        messageSid: recovered.messageSid,
        status: recovered.status,
        operationHash: stablePayloadHash(authority.operation),
      });
      return { outcome: 'succeeded', providerReceiptId: recovered.messageSid, providerStatus: recovered.status };
    } catch (error) {
      return providerError(error);
    }
  }
}
