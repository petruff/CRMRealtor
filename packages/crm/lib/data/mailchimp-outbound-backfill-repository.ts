import type { WorkspaceScope } from '../domain/workspace.ts';
import type { MailchimpMemberOperation } from '../domain/mailchimp.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

export type MailchimpOutboundBackfillMode = 'backfill' | 'tag-reconcile';
export type MailchimpOutboundBackfillState =
  | 'previewed' | 'approved' | 'leased' | 'executing' | 'retry_wait'
  | 'succeeded' | 'review' | 'cancelled';

export interface MailchimpOutboundBackfillPreview {
  readonly runId: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly mode: MailchimpOutboundBackfillMode;
  readonly mappingVersion: number;
  readonly snapshotHash: string;
  readonly eligibleCount: number;
  readonly skippedUnlinkedCount: number;
  readonly skippedUnsubscribedCount: number;
  readonly pageSize: number;
  readonly containsRawEmails: false;
  readonly noOp: boolean;
}

export interface MailchimpOutboundBackfillRun {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly mode: MailchimpOutboundBackfillMode;
  readonly mappingVersion: number;
  readonly snapshotHash: string;
  readonly eligibleCount: number;
  readonly pageSize: number;
  readonly state: MailchimpOutboundBackfillState;
  readonly nextOffset: number;
  readonly jobsEnqueued: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly requestOrigin: 'owner' | 'scheduler';
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly fencingToken: number;
  readonly previewedAt: string;
  readonly completedAt?: string;
}

export interface MailchimpOutboundBackfillPage {
  readonly run: Pick<MailchimpOutboundBackfillRun,
    'id' | 'workspaceId' | 'connectionId' | 'bindingId' | 'mode' | 'snapshotHash'
    | 'mappingVersion' | 'pageSize' | 'eligibleCount' | 'nextOffset' | 'fencingToken'
    | 'leaseExpiresAt'>;
  readonly binding: {
    readonly connectionId: string;
    readonly workspaceId: string;
    readonly bindingId: string;
    readonly dataCenter: string;
    readonly audienceId: string;
    readonly accountIdHash: string;
    readonly mappingVersion: number;
  };
  readonly offset: number;
  readonly items: readonly { readonly itemIndex: number; readonly operation: MailchimpMemberOperation }[];
  readonly pageHash: string;
  readonly finalPage: boolean;
}

export interface MailchimpOutboundBackfillRepository {
  preview(scope: WorkspaceScope, input: {
    readonly connectionId: string;
    readonly mode: MailchimpOutboundBackfillMode;
    readonly requestKeyHash: string;
    readonly pageSize: number;
    readonly correlationId: string;
    readonly previewedAt: string;
    readonly maxAttempts: number;
  }): Promise<MailchimpOutboundBackfillPreview>;
  approve(scope: WorkspaceScope, input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly mappingVersion: number;
    readonly correlationId: string;
    readonly approvedAt: string;
  }): Promise<{ readonly run: MailchimpOutboundBackfillRun; readonly noOp: boolean }>;
  list(scope: WorkspaceScope, connectionId: string, limit: number): Promise<readonly MailchimpOutboundBackfillRun[]>;
  scheduleDue(input: { readonly now: string; readonly intervalSeconds: number; readonly limit: number }): Promise<readonly MailchimpOutboundBackfillRun[]>;
  claim(input: { readonly workerId: string; readonly batchSize: number; readonly leaseSeconds: number; readonly now: string }): Promise<readonly MailchimpOutboundBackfillRun[]>;
  start(input: { readonly runId: string; readonly workerId: string; readonly fencingToken: number; readonly startedAt: string }): Promise<MailchimpOutboundBackfillRun>;
  readPage(input: { readonly runId: string; readonly workerId: string; readonly fencingToken: number; readonly now: string }): Promise<MailchimpOutboundBackfillPage>;
  enqueuePage(input: {
    readonly runId: string;
    readonly workerId: string;
    readonly fencingToken: number;
    readonly offset: number;
    readonly pageHash: string;
    readonly envelopes: readonly { readonly itemIndex: number; readonly operationKey: string; readonly envelope: ConnectorSecretEnvelope }[];
    readonly occurredAt: string;
  }): Promise<{ readonly run: MailchimpOutboundBackfillRun; readonly jobIds: readonly string[]; readonly finalPage: boolean; readonly noOp: boolean }>;
  settle(input: { readonly runId: string; readonly workerId: string; readonly fencingToken: number; readonly retryAt: string; readonly occurredAt: string }): Promise<{ readonly run: MailchimpOutboundBackfillRun; readonly completed: boolean; readonly noOp: boolean }>;
  transition(input: { readonly runId: string; readonly workerId: string; readonly fencingToken: number; readonly outcome: 'retry' | 'review'; readonly errorCategory: string; readonly retryAt?: string; readonly occurredAt: string }): Promise<MailchimpOutboundBackfillRun>;
}
