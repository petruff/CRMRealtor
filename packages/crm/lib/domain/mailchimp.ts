import { createHash } from 'node:crypto';
import { ConnectorError, stablePayloadHash } from './connector.ts';

export const MAILCHIMP_TAG_MAPPING_VERSION = 1;
export const MAILCHIMP_LEAD_TAGS = Object.freeze({
  hot: 'Omnix: Hot',
  warm: 'Omnix: Warm',
  nurture: 'Omnix: Nurture',
} as const);

export type MailchimpLeadType = keyof typeof MAILCHIMP_LEAD_TAGS;
export type MailchimpSubscriptionStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'pending'
  | 'cleaned'
  | 'transactional'
  | 'archived';

export interface MailchimpAccountIdentity {
  readonly accountId: string;
  readonly accountName: string;
  readonly dataCenter: string;
  readonly apiBaseUrl: string;
}

export interface MailchimpAudience {
  readonly id: string;
  readonly name: string;
  readonly memberCount?: number;
}

export interface MailchimpAudienceBinding {
  readonly id?: string;
  readonly connectionId: string;
  readonly accountIdHash: string;
  readonly dataCenter: string;
  readonly audienceId: string;
  readonly audienceName: string;
  readonly mappingVersion: number;
  readonly selectedAt: string;
  readonly baselineRequired?: boolean;
  readonly webhookRegistrationRequired?: boolean;
}

export interface MailchimpMemberOperation {
  readonly audienceId: string;
  readonly subscriberHash: string;
  readonly desiredTag: (typeof MAILCHIMP_LEAD_TAGS)[MailchimpLeadType];
  readonly mappingVersion: number;
  readonly operationKey: string;
  readonly contactId?: string;
  readonly contactPointId?: string;
  readonly reviewedAliasEpoch?: number;
}

export interface MailchimpWebhookEvent {
  readonly eventId: string;
  readonly audienceId: string;
  readonly memberId?: string;
  readonly normalizedEmail: string;
  readonly subscriptionStatus: MailchimpSubscriptionStatus;
  readonly occurredAt: string;
  readonly origin: 'mailchimp-webhook';
}

export interface MailchimpAudienceMember {
  readonly memberId: string;
  readonly subscriberHash: string;
  readonly normalizedEmail: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phone?: string;
  readonly subscriptionStatus: MailchimpSubscriptionStatus;
  readonly lastChangedAt: string;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', `${field} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, field, max);
}

export function parseMailchimpDataCenter(value: unknown): string {
  const clean = text(value, 'dataCenter', 32).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) {
    throw new ConnectorError('invalid-input', 'Mailchimp data center is invalid.');
  }
  return clean;
}

export function createMailchimpAccountIdentity(input: {
  readonly accountId: unknown;
  readonly accountName: unknown;
  readonly dataCenter: unknown;
}): MailchimpAccountIdentity {
  const dataCenter = parseMailchimpDataCenter(input.dataCenter);
  return {
    accountId: text(input.accountId, 'accountId', 128),
    accountName: text(input.accountName, 'accountName', 160),
    dataCenter,
    apiBaseUrl: `https://${dataCenter}.api.mailchimp.com/3.0`,
  };
}

export function parseMailchimpAudience(value: unknown): MailchimpAudience {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('invalid-input', 'Mailchimp audience is invalid.');
  }
  const row = value as Record<string, unknown>;
  const memberCount = row.memberCount === undefined ? undefined : Number(row.memberCount);
  if (memberCount !== undefined && (!Number.isSafeInteger(memberCount) || memberCount < 0)) {
    throw new ConnectorError('invalid-input', 'Mailchimp audience member count is invalid.');
  }
  return {
    id: text(row.id, 'audienceId', 128),
    name: text(row.name, 'audienceName', 160),
    ...(memberCount !== undefined ? { memberCount } : {}),
  };
}

export function mailchimpSubscriberHash(normalizedEmail: string): string {
  const email = text(normalizedEmail, 'email', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConnectorError('invalid-input', 'Mailchimp member email is invalid.');
  }
  return createHash('md5').update(email, 'utf8').digest('hex');
}

export function createMailchimpMemberOperation(input: {
  readonly audienceId: string;
  readonly normalizedEmail: string;
  readonly leadType: MailchimpLeadType;
}): MailchimpMemberOperation {
  const audienceId = text(input.audienceId, 'audienceId', 128);
  const subscriberHash = mailchimpSubscriberHash(input.normalizedEmail);
  const desiredTag = MAILCHIMP_LEAD_TAGS[input.leadType];
  return {
    audienceId,
    subscriberHash,
    desiredTag,
    mappingVersion: MAILCHIMP_TAG_MAPPING_VERSION,
    operationKey: stablePayloadHash({
      audienceId,
      subscriberHash,
      desiredTag,
      mappingVersion: MAILCHIMP_TAG_MAPPING_VERSION,
    }),
  };
}

export function parseMailchimpWebhookEvent(value: unknown): MailchimpWebhookEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook event is invalid.');
  }
  const row = value as Record<string, unknown>;
  const status = row.subscriptionStatus as MailchimpSubscriptionStatus;
  if (!['subscribed', 'unsubscribed', 'pending', 'cleaned', 'transactional', 'archived'].includes(status)) {
    throw new ConnectorError('invalid-input', 'Mailchimp subscription status is invalid.');
  }
  const occurredAt = text(row.occurredAt, 'occurredAt', 64);
  if (!Number.isFinite(new Date(occurredAt).getTime())) {
    throw new ConnectorError('invalid-input', 'Mailchimp event timestamp is invalid.');
  }
  const normalizedEmail = text(row.normalizedEmail, 'normalizedEmail', 320).toLowerCase();
  mailchimpSubscriberHash(normalizedEmail);
  return {
    eventId: text(row.eventId, 'eventId', 128),
    audienceId: text(row.audienceId, 'audienceId', 128),
    ...(row.memberId ? { memberId: text(row.memberId, 'memberId', 128) } : {}),
    normalizedEmail,
    subscriptionStatus: status,
    occurredAt: new Date(occurredAt).toISOString(),
    origin: 'mailchimp-webhook',
  };
}

export function parseMailchimpAudienceMember(value: unknown): MailchimpAudienceMember {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('invalid-input', 'Mailchimp audience member is invalid.');
  }
  const row = value as Record<string, unknown>;
  const normalizedEmail = text(row.normalizedEmail, 'normalizedEmail', 320).toLowerCase();
  const subscriberHash = text(row.subscriberHash, 'subscriberHash', 32).toLowerCase();
  if (mailchimpSubscriberHash(normalizedEmail) !== subscriberHash) {
    throw new ConnectorError('invalid-input', 'Mailchimp member identity is invalid.');
  }
  const subscriptionStatus = row.subscriptionStatus as MailchimpSubscriptionStatus;
  if (!['subscribed', 'unsubscribed', 'pending', 'cleaned', 'transactional', 'archived'].includes(subscriptionStatus)) {
    throw new ConnectorError('invalid-input', 'Mailchimp member status is invalid.');
  }
  const lastChangedAt = text(row.lastChangedAt, 'lastChangedAt', 64);
  if (!Number.isFinite(new Date(lastChangedAt).getTime())) {
    throw new ConnectorError('invalid-input', 'Mailchimp member timestamp is invalid.');
  }
  const firstName = optionalText(row.firstName, 'firstName', 120);
  const lastName = optionalText(row.lastName, 'lastName', 120);
  const phone = optionalText(row.phone, 'phone', 64);
  return {
    memberId: text(row.memberId, 'memberId', 128),
    subscriberHash,
    normalizedEmail,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(phone ? { phone } : {}),
    subscriptionStatus,
    lastChangedAt: new Date(lastChangedAt).toISOString(),
  };
}

export function isMailchimpOutboundEcho(input: {
  readonly event: MailchimpWebhookEvent;
  readonly selectedAudienceId: string;
  readonly originatingOperationKey?: string;
  readonly observedOperationKey?: string;
}): boolean {
  if (input.event.audienceId !== input.selectedAudienceId) return false;
  return Boolean(
    input.originatingOperationKey
    && input.observedOperationKey
    && input.originatingOperationKey === input.observedOperationKey,
  );
}
