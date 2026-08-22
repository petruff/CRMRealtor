import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { supabaseContactOutboundGuard } from './supabase-contact-outbound-guard.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return value;
}
function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return Number(value);
}
function failure(error: { code?: string }, message: string): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  return new Error(`${message}: persistence failed.`);
}

export interface MetaConnectionState {
  readonly connectionId: string;
  readonly loginMode: string;
  readonly graphVersion: string;
  readonly readiness: string;
  readonly enabled: boolean;
  readonly inboundOnly: boolean;
  readonly snapshotHash?: string;
  readonly assets: readonly { channel: string; label: string; state: string; assetIdHash: string;
    subscriptionStatus?: string; subscriptionError?: string }[];
  readonly selectedAssets: readonly { channel: string; label: string; state: string; assetIdHash: string;
    subscriptionStatus?: string; subscriptionError?: string }[];
  readonly reviewBacklog: number;
  readonly normalizationBacklog: number;
  readonly retentionDays: number;
  readonly lastWebhookAt?: string;
}

export interface MetaReviewItem {
  readonly eventId: string; readonly channel: string; readonly reason: string;
  readonly providerOccurredAt: string; readonly receivedAt: string; readonly assetLabel: string;
  readonly incompleteRecordId: string;
  readonly attachmentTypes: readonly string[];
  readonly textPreview?: string;
  readonly sourceReference?: string;
}

export interface MetaReviewResolutionRepository {
  resolveReview(
    scope: WorkspaceScope,
    input: { eventId: string; contactId: string; correlationId: string },
  ): Promise<{ noOp: boolean }>;
}

export function supabaseMetaOperationRepository(client: SupabaseClient) {
  const outboundGuard = supabaseContactOutboundGuard(client);
  return {
    async readConnectionState(scope: WorkspaceScope, connectionId: string): Promise<MetaConnectionState> {
      if (!scope.workspaceId || !connectionId) throw new ConnectorError('forbidden', 'Meta workspace scope is required.');
      const { data, error } = await client.rpc('read_meta_connection_state', { target_connection_id: connectionId });
      if (error) throw failure(error, 'Meta connection state is unavailable');
      const row = object(data, 'Meta connection state is invalid.');
      const connection = object(row.connection, 'Meta connection is invalid.');
      const authority = object(row.authority, 'Meta authority is invalid.');
      if (connection.workspace_id !== scope.workspaceId || connection.id !== connectionId) {
        throw new ConnectorError('forbidden', 'Meta connection scope is invalid.');
      }
      const subscriptionResult = await client.from('meta_asset_subscription_states')
        .select('asset_binding_id,status,last_error_category')
        .eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId).limit(100);
      if (subscriptionResult.error) throw failure(subscriptionResult.error, 'Meta subscription state is unavailable');
      const subscriptions = new Map((subscriptionResult.data ?? []).map((value) => {
        const item = object(value, 'Meta subscription state is invalid.');
        return [text(item.asset_binding_id, 'asset binding id'), item] as const;
      }));
      const assets = (Array.isArray(row.assets) ? row.assets : []).map((value) => {
        const asset = object(value, 'Meta asset state is invalid.');
        const subscription = subscriptions.get(text(asset.id, 'asset binding id'));
        return { channel: text(asset.channel, 'channel'), label: text(asset.display_label, 'asset label'),
          state: text(asset.state, 'asset state'), assetIdHash: text(asset.asset_id_hash, 'asset hash'),
          ...(subscription ? { subscriptionStatus: text(subscription.status, 'subscription status') } : {}),
          ...(subscription && typeof subscription.last_error_category === 'string'
            ? { subscriptionError: subscription.last_error_category } : {}) };
      });
      return {
        connectionId,
        loginMode: text(authority.login_mode, 'loginMode'),
        graphVersion: text(authority.graph_version, 'graphVersion'),
        readiness: text(authority.readiness_state, 'readiness'),
        enabled: authority.enabled === true,
        inboundOnly: row.inboundOnly === true,
        ...(typeof authority.eligibility_snapshot_hash === 'string' ? { snapshotHash: authority.eligibility_snapshot_hash } : {}),
        assets,
        selectedAssets: assets.filter((asset) => asset.state === 'selected'),
        reviewBacklog: integer(row.reviewBacklog, 'review backlog'),
        normalizationBacklog: integer(row.normalizationBacklog, 'normalization backlog'),
        retentionDays: integer(authority.retention_days, 'retention days'),
        ...(typeof authority.last_webhook_at === 'string' ? { lastWebhookAt: authority.last_webhook_at } : {}),
      };
    },
    async listReviewItems(scope: WorkspaceScope, connectionId: string, limit = 20): Promise<readonly MetaReviewItem[]> {
      if (!scope.workspaceId || !connectionId || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ConnectorError('invalid-input', 'Meta review query is invalid.');
      }
      const { data, error } = await client.from('meta_inbound_events')
        .select('id,channel,review_reason,incomplete_record_id,attachment_types,provider_occurred_at,received_at,meta_asset_bindings!inner(display_label)')
        .eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId).eq('state', 'review')
        .order('received_at', { ascending: false }).limit(limit);
      if (error) throw failure(error, 'Meta review queue is unavailable');
      return (data ?? []).map((value) => {
        const row = object(value, 'Meta review item is invalid.');
        const joined = Array.isArray(row.meta_asset_bindings) ? row.meta_asset_bindings[0] : row.meta_asset_bindings;
        const asset = object(joined, 'Meta review asset is invalid.');
        return { eventId: text(row.id, 'event id'), channel: text(row.channel, 'channel'),
          reason: text(row.review_reason, 'review reason'), providerOccurredAt: text(row.provider_occurred_at, 'provider time'),
          receivedAt: text(row.received_at, 'received time'), assetLabel: text(asset.display_label, 'asset label'),
          incompleteRecordId: text(row.incomplete_record_id, 'incomplete record id'),
          attachmentTypes: Array.isArray(row.attachment_types)
            ? row.attachment_types.filter((item): item is string => typeof item === 'string').slice(0, 20) : [] };
      });
    },
    async resolveReview(scope: WorkspaceScope, input: { eventId: string; contactId: string; correlationId: string }) {
      const reviewedTarget = await outboundGuard.assertTarget(scope, input.contactId);
      await outboundGuard.assertTarget(scope, input.contactId, undefined, reviewedTarget.aliasEpoch);
      const { data, error } = await client.rpc('resolve_meta_enquiry_review', {
        target_event_id: input.eventId, target_contact_id: input.contactId,
        target_actor_membership_id: scope.membershipId,
        target_idempotency_key: `meta-review:${input.eventId}:${input.contactId}`,
        target_correlation_id: input.correlationId, target_occurred_at: new Date().toISOString(),
      });
      if (error) throw failure(error, 'Meta review could not be resolved');
      return { noOp: object(data, 'Meta review resolution is invalid.').noOp === true };
    },
  };
}
