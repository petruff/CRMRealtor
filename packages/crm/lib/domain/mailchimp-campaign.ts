import { ConnectorError, stablePayloadHash } from './connector.ts';
import { MAILCHIMP_LEAD_TAGS, type MailchimpAudienceMember, type MailchimpLeadType } from './mailchimp.ts';

export const MAILCHIMP_CAMPAIGN_SCHEMA_VERSION = 'mailchimp-campaign.v1' as const;

export type MailchimpCampaignSegment =
  | { readonly kind: 'all-subscribers' }
  | { readonly kind: 'lead-type'; readonly value: MailchimpLeadType };

export interface MailchimpCampaignContent {
  readonly title: string;
  readonly subject: string;
  readonly previewText: string;
  readonly fromName: string;
  readonly replyTo: string;
  readonly html: string;
  readonly plainText: string;
}

export interface MailchimpCampaignAudiencePreview {
  readonly schemaVersion: typeof MAILCHIMP_CAMPAIGN_SCHEMA_VERSION;
  readonly audienceId: string;
  readonly audienceName: string;
  readonly segment: MailchimpCampaignSegment;
  readonly eligibleCount: number;
  readonly excluded: Readonly<{
    unsubscribed: number;
    nonSubscribed: number;
    cleaned: number;
    pending: number;
    archived: number;
    duplicate: number;
    invalid: number;
  }>;
  readonly recipientSnapshotHash: string;
  readonly contentHash: string;
  readonly asOf: string;
}

export type MailchimpCampaignState =
  | 'draft' | 'create_approved' | 'created' | 'send_approved' | 'sent' | 'failed';

export interface MailchimpCampaignRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly version: number;
  readonly state: MailchimpCampaignState;
  readonly segment: MailchimpCampaignSegment;
  readonly content: MailchimpCampaignContent;
  readonly contentHash: string;
  readonly recipientSnapshotHash: string;
  readonly eligibleCount: number;
  readonly excluded: MailchimpCampaignAudiencePreview['excluded'];
  readonly remoteCampaignId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function mailchimpProviderCampaignTitle(campaign: Pick<MailchimpCampaignRecord, 'id' | 'content'>): string {
  const suffix = ` [Omnix ${campaign.id.slice(0, 8)}]`;
  return `${campaign.content.title.slice(0, 160 - suffix.length).trimEnd()}${suffix}`;
}

function text(value: unknown, label: string, maximum: number, allowNewlines = false): string {
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', `${label} is required.`);
  const clean = value.trim();
  const controls = allowNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (!clean || clean.length > maximum || controls.test(clean)) {
    throw new ConnectorError('invalid-input', `${label} is invalid.`);
  }
  return clean;
}

function email(value: unknown): string {
  const clean = text(value, 'replyTo', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(clean)) {
    throw new ConnectorError('invalid-input', 'replyTo is invalid.');
  }
  return clean;
}

export function parseMailchimpCampaignSegment(value: unknown): MailchimpCampaignSegment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('invalid-input', 'Campaign segment is invalid.');
  }
  const row = value as Record<string, unknown>;
  if (row.kind === 'all-subscribers') return { kind: 'all-subscribers' };
  if (row.kind === 'lead-type' && ['hot', 'warm', 'nurture'].includes(String(row.value))) {
    return { kind: 'lead-type', value: row.value as MailchimpLeadType };
  }
  throw new ConnectorError('invalid-input', 'Campaign segment is not supported.');
}

export function parseMailchimpCampaignContent(value: unknown): MailchimpCampaignContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('invalid-input', 'Campaign content is invalid.');
  }
  const row = value as Record<string, unknown>;
  return {
    title: text(row.title, 'title', 160),
    subject: text(row.subject, 'subject', 150),
    previewText: text(row.previewText, 'previewText', 150),
    fromName: text(row.fromName, 'fromName', 100),
    replyTo: email(row.replyTo),
    html: text(row.html, 'html', 250_000, true),
    plainText: text(row.plainText, 'plainText', 100_000, true),
  };
}

export function mailchimpSegmentOptions(segment: MailchimpCampaignSegment): Readonly<Record<string, unknown>> | undefined {
  if (segment.kind === 'all-subscribers') return undefined;
  return { tagName: MAILCHIMP_LEAD_TAGS[segment.value] };
}

export function previewMailchimpCampaign(input: {
  readonly audienceId: string;
  readonly audienceName: string;
  readonly segment: MailchimpCampaignSegment;
  readonly content: MailchimpCampaignContent;
  readonly members: readonly MailchimpAudienceMember[];
  readonly memberTagNames?: Readonly<Record<string, readonly string[]>>;
  readonly asOf: string;
}): MailchimpCampaignAudiencePreview {
  const segment = parseMailchimpCampaignSegment(input.segment);
  const content = parseMailchimpCampaignContent(input.content);
  const seen = new Set<string>();
  const eligible: string[] = [];
  const excluded = { unsubscribed: 0, nonSubscribed: 0, cleaned: 0, pending: 0, archived: 0, duplicate: 0, invalid: 0 };
  for (const member of input.members) {
    if (!/^[a-f0-9]{32}$/u.test(member.subscriberHash)) { excluded.invalid += 1; continue; }
    if (seen.has(member.subscriberHash)) { excluded.duplicate += 1; continue; }
    seen.add(member.subscriberHash);
    if (member.subscriptionStatus !== 'subscribed') {
      if (member.subscriptionStatus === 'unsubscribed') excluded.unsubscribed += 1;
      else if (member.subscriptionStatus === 'cleaned') excluded.cleaned += 1;
      else if (member.subscriptionStatus === 'pending') excluded.pending += 1;
      else if (member.subscriptionStatus === 'archived') excluded.archived += 1;
      else excluded.nonSubscribed += 1;
      continue;
    }
    if (segment.kind === 'lead-type') {
      const tags = input.memberTagNames?.[member.subscriberHash] ?? [];
      if (!tags.includes(MAILCHIMP_LEAD_TAGS[segment.value])) continue;
    }
    eligible.push(member.subscriberHash);
  }
  const asOf = new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime())) throw new ConnectorError('invalid-input', 'Campaign preview timestamp is invalid.');
  return {
    schemaVersion: MAILCHIMP_CAMPAIGN_SCHEMA_VERSION,
    audienceId: text(input.audienceId, 'audienceId', 128),
    audienceName: text(input.audienceName, 'audienceName', 160),
    segment,
    eligibleCount: eligible.length,
    excluded,
    recipientSnapshotHash: stablePayloadHash(eligible.sort()),
    contentHash: stablePayloadHash(content),
    asOf: asOf.toISOString(),
  };
}
