import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import {
  parseMailchimpCampaignContent,
  parseMailchimpCampaignSegment,
  type MailchimpCampaignRecord,
  type MailchimpCampaignState,
} from '../domain/mailchimp-campaign.ts';
import type { MailchimpCampaignRepository } from './mailchimp-campaign-repository.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ConnectorError('conflict', `${field} is invalid.`);
  return Number(value);
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function campaign(value: unknown): MailchimpCampaignRecord {
  const row = object(value, 'Mailchimp campaign is invalid.');
  const state = text(row.state, 'state') as MailchimpCampaignState;
  if (!['draft', 'create_approved', 'created', 'send_approved', 'sent', 'failed'].includes(state)) {
    throw new ConnectorError('conflict', 'Mailchimp campaign state is invalid.');
  }
  const exclusions = object(row.exclusion_counts, 'Mailchimp campaign exclusions are invalid.');
  const excluded = {
    unsubscribed: count(exclusions.unsubscribed, 'unsubscribed'),
    nonSubscribed: count(exclusions.nonSubscribed, 'nonSubscribed'),
    cleaned: count(exclusions.cleaned, 'cleaned'),
    pending: count(exclusions.pending, 'pending'),
    archived: count(exclusions.archived, 'archived'),
    duplicate: count(exclusions.duplicate, 'duplicate'),
    invalid: count(exclusions.invalid, 'invalid'),
  };
  return {
    id: text(row.id, 'id'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), bindingId: text(row.binding_id, 'bindingId'),
    version: count(row.version, 'version'), state,
    segment: parseMailchimpCampaignSegment({ kind: row.segment_kind, value: row.segment_value }),
    content: parseMailchimpCampaignContent({
      title: row.title, subject: row.subject, previewText: row.preview_text,
      fromName: row.from_name, replyTo: row.reply_to, html: row.html_content,
      plainText: row.plain_text_content,
    }),
    contentHash: text(row.content_hash, 'contentHash'),
    recipientSnapshotHash: text(row.recipient_snapshot_hash, 'recipientSnapshotHash'),
    eligibleCount: count(row.eligible_count, 'eligibleCount'), excluded,
    ...(typeof row.remote_campaign_id === 'string' && row.remote_campaign_id
      ? { remoteCampaignId: row.remote_campaign_id } : {}),
    createdAt: text(row.created_at, 'createdAt'), updatedAt: text(row.updated_at, 'updatedAt'),
  };
}

export function supabaseMailchimpCampaignRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly service: SupabaseClient;
}): MailchimpCampaignRepository {
  return {
    async list(scope, limit = 50, offset = 0) {
      const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 50;
      const safeOffset = Number.isInteger(offset) && offset >= 0 && offset <= 10_000 ? offset : 0;
      const { data, error } = await input.authenticated.from('mailchimp_campaigns').select('*')
        .eq('workspace_id', scope.workspaceId).order('updated_at', { ascending: false })
        .range(safeOffset, safeOffset + safeLimit - 1);
      if (error) throw persistenceError('Failed to list Mailchimp campaigns', error);
      return (data ?? []).map(campaign);
    },
    async get(scope, campaignId) {
      const { data, error } = await input.authenticated.from('mailchimp_campaigns').select('*')
        .eq('workspace_id', scope.workspaceId).eq('id', campaignId).maybeSingle();
      if (error) throw persistenceError('Failed to read Mailchimp campaign', error);
      return data ? campaign(data) : undefined;
    },
    async createDraft(_scope, value) {
      const contentHash = stablePayloadHash(value.content);
      const { data, error } = await input.authenticated.rpc('create_mailchimp_campaign_draft', {
        target_connection_id: value.connectionId,
        target_segment_kind: value.segment.kind,
        target_segment_value: value.segment.kind === 'lead-type' ? value.segment.value : null,
        target_title: value.content.title, target_subject: value.content.subject,
        target_preview_text: value.content.previewText, target_from_name: value.content.fromName,
        target_reply_to: value.content.replyTo, target_html_content: value.content.html,
        target_plain_text_content: value.content.plainText, target_content_hash: contentHash,
        target_correlation_id: value.correlationId, target_occurred_at: value.occurredAt,
      });
      if (error) throw persistenceError('Failed to create Mailchimp campaign draft', error);
      return campaign(object(data, 'Mailchimp campaign draft envelope is invalid.').campaign);
    },
    async updateDraft(_scope, value) {
      const contentHash = stablePayloadHash(value.content);
      const { data, error } = await input.authenticated.rpc('update_mailchimp_campaign_draft', {
        target_campaign_id: value.campaignId,
        target_expected_version: value.version,
        target_segment_kind: value.segment.kind,
        target_segment_value: value.segment.kind === 'lead-type' ? value.segment.value : null,
        target_title: value.content.title,
        target_subject: value.content.subject,
        target_preview_text: value.content.previewText,
        target_from_name: value.content.fromName,
        target_reply_to: value.content.replyTo,
        target_html_content: value.content.html,
        target_plain_text_content: value.content.plainText,
        target_content_hash: contentHash,
        target_correlation_id: value.correlationId,
        target_occurred_at: value.occurredAt,
      });
      if (error) throw persistenceError('Failed to update Mailchimp campaign draft', error);
      return campaign(object(data, 'Mailchimp campaign revision envelope is invalid.').campaign);
    },
    async approve(_scope, value) {
      const { data, error } = await input.authenticated.rpc('approve_mailchimp_campaign_action', {
        target_campaign_id: value.campaignId, target_expected_version: value.version,
        target_action: value.action, target_expected_content_hash: value.contentHash,
        target_expected_recipient_snapshot_hash: value.recipientSnapshotHash,
        target_correlation_id: value.correlationId, target_occurred_at: value.occurredAt,
      });
      if (error) throw persistenceError('Failed to approve Mailchimp campaign action', error);
      return campaign(object(data, 'Mailchimp campaign approval envelope is invalid.').campaign);
    },
    async claimExecution(value) {
      const { data, error } = await input.service.rpc('claim_mailchimp_campaign_execution', {
        target_campaign_id: value.campaignId,
        target_action: value.action,
        target_execution_token: value.executionToken,
        target_occurred_at: value.occurredAt,
      });
      if (error) throw persistenceError('Failed to claim Mailchimp campaign execution', error);
      return campaign(object(data, 'Mailchimp campaign execution envelope is invalid.').campaign);
    },
    async recordProviderResult(value) {
      const { data, error } = await input.service.rpc('record_mailchimp_campaign_provider_result', {
        target_campaign_id: value.campaignId, target_action: value.action, target_outcome: value.outcome,
        target_provider_campaign_id: value.providerCampaignId ?? null,
        target_provider_status: value.providerStatus ?? null,
        target_error_category: value.errorCategory ?? null, target_request_hash: value.requestHash,
        target_correlation_id: value.correlationId, target_occurred_at: value.occurredAt,
        target_execution_token: value.executionToken,
      });
      if (error) throw persistenceError('Failed to record Mailchimp campaign result', error);
      return campaign(object(data, 'Mailchimp campaign result envelope is invalid.').campaign);
    },
  };
}
