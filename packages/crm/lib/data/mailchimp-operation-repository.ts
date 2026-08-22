import type { WorkspaceScope } from '../domain/workspace.ts';
import type { MailchimpAudience, MailchimpAudienceBinding, MailchimpMemberOperation } from '../domain/mailchimp.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';
import type { ConnectorConnectionStatus, ConnectorErrorCategory } from '../domain/connector.ts';
import type { SupabaseMailchimpWebhookRepository } from './supabase-mailchimp-webhook-repository.ts';

export interface MailchimpConnectionAuthority {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly accountIdHash: string;
  readonly dataCenter: string;
  readonly secretVersion: number;
  readonly grantedScopes: readonly string[];
  readonly accessTokenEnvelope: ConnectorSecretEnvelope;
}

export interface MailchimpSyncPolicy {
  readonly id: string;
  readonly version: number;
  readonly noOp: boolean;
}

export interface MailchimpStoredOperation {
  readonly payloadReference: string;
  readonly payloadHash: string;
  readonly envelopeVersion: number;
}

export interface MailchimpOperationRepository {
  readConnectionAuthority(scope: WorkspaceScope, connectionId: string): Promise<MailchimpConnectionAuthority>;
  getSelectedAudience(scope: WorkspaceScope, connectionId: string): Promise<MailchimpAudienceBinding | undefined>;
  hasLinkedMember(
    scope: WorkspaceScope,
    input: { readonly connectionId: string; readonly subscriberHash: string },
  ): Promise<boolean>;
  selectAudience(
    scope: WorkspaceScope,
    input: {
      readonly connectionId: string;
      readonly accountIdHash: string;
      readonly dataCenter: string;
      readonly audience: MailchimpAudience;
      readonly mappingVersion: number;
      readonly correlationId: string;
      readonly selectedAt: string;
    },
  ): Promise<{ readonly binding: MailchimpAudienceBinding; readonly noOp: boolean }>;
  ensureSyncPolicy(
    scope: WorkspaceScope,
    input: { readonly correlationId: string; readonly occurredAt: string },
  ): Promise<MailchimpSyncPolicy>;
  storeOperation(
    scope: WorkspaceScope,
    input: {
      readonly connectionId: string;
      readonly operation: MailchimpMemberOperation;
      readonly envelope: ConnectorSecretEnvelope;
    },
  ): Promise<MailchimpStoredOperation>;
  recordProbe(
    scope: WorkspaceScope,
    input: {
      readonly connectionId: string;
      readonly status: Extract<ConnectorConnectionStatus, 'active' | 'degraded' | 'reauthorization-required'>;
      readonly accountIdHash: string;
      readonly grantedScopes: readonly string[];
      readonly occurredAt: string;
      readonly errorCategory: ConnectorErrorCategory;
      readonly correlationId: string;
    },
  ): Promise<{ readonly status: ConnectorConnectionStatus; readonly occurredAt: string; readonly noOp: boolean }>;
}

export type MailchimpSetupRepository = MailchimpOperationRepository
  & Pick<SupabaseMailchimpWebhookRepository,
    'readSetupState' | 'bindSigningSecret' | 'applyBaselineMember' | 'completeBaseline'>;
