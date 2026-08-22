import type {
  ConnectorActionIntent,
  ConnectorConnection,
  ConnectorDefinition,
  ConnectorErrorCategory,
  ConnectorJob,
  ConnectorJobState,
  ConnectorProvider,
  ConnectorReceipt,
  ConnectorReceiptType,
} from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';

export interface ConnectorListQuery {
  readonly provider?: ConnectorProvider;
  readonly limit: number;
}

export interface ConnectorJobQuery extends ConnectorListQuery {
  readonly state?: ConnectorJobState | 'all';
}

export interface ConnectorReceiptQuery extends ConnectorListQuery {
  readonly jobId?: string;
  readonly intentId?: string;
}

export interface CreateConnectorIntentInput {
  readonly provider: ConnectorProvider;
  readonly connectionId?: string;
  readonly actionType: string;
  readonly payloadReference: string;
  readonly payloadHash: string;
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly complianceSnapshot?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
  readonly summary: string;
  readonly requestedByMembershipId: string;
  readonly createdAt: string;
}

export interface EditConnectorIntentInput {
  readonly intentId: string;
  readonly expectedVersion: number;
  readonly payloadReference: string;
  readonly payloadHash: string;
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly complianceSnapshot?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
  readonly summary: string;
  readonly editedByMembershipId: string;
  readonly editedAt: string;
}

export interface DecideConnectorIntentInput {
  readonly intentId: string;
  readonly expectedVersion: number;
  readonly actorMembershipId: string;
  readonly decidedAt: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface ApproveConnectorIntentResult {
  readonly intent: ConnectorActionIntent;
  readonly job: ConnectorJob;
  readonly receipt: ConnectorReceipt;
  readonly noOp: boolean;
}

export interface LeaseConnectorJobsInput {
  readonly workerId: string;
  readonly now: string;
  readonly leaseSeconds: number;
  readonly limit: number;
  readonly states?: readonly ('queued' | 'retry-scheduled' | 'reconciliation-required')[];
}

export interface BeginConnectorAttemptInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly fencingToken: number;
  readonly occurredAt: string;
}

export interface CompleteConnectorJobInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly fencingToken: number;
  readonly providerReceiptId: string;
  readonly providerStatus: string;
  readonly requestHash: string;
  readonly occurredAt: string;
}

export interface DeferConnectorJobInput {
  readonly jobId: string;
  readonly workerId: string;
  readonly fencingToken: number;
  readonly errorCategory: ConnectorErrorCategory;
  readonly detail?: string;
  readonly nextAttemptAt?: string;
  readonly occurredAt: string;
}

export interface AppendConnectorReceiptInput {
  readonly provider: ConnectorProvider;
  readonly intentId?: string;
  readonly jobId?: string;
  readonly attemptNumber?: number;
  readonly type: ConnectorReceiptType;
  readonly correlationId: string;
  readonly actorMembershipId?: string;
  readonly requestHash?: string;
  readonly providerReceiptId?: string;
  readonly providerStatus?: string;
  readonly errorCategory: ConnectorErrorCategory;
  readonly detail?: string;
  readonly occurredAt: string;
}

/** Workspace-scoped connector authority. There is no secret-returning browser seam. */
export interface ConnectorRepository {
  listDefinitions(scope: WorkspaceScope): Promise<readonly ConnectorDefinition[]>;
  listConnections(scope: WorkspaceScope, query: ConnectorListQuery): Promise<readonly ConnectorConnection[]>;
  getConnection(scope: WorkspaceScope, id: string): Promise<ConnectorConnection | undefined>;
  disconnectConnection(
    scope: WorkspaceScope,
    input: { connectionId: string; actorMembershipId: string; occurredAt: string; correlationId: string },
  ): Promise<{ connection: ConnectorConnection; receipt: ConnectorReceipt; noOp: boolean }>;
  listIntents(scope: WorkspaceScope, query: ConnectorListQuery): Promise<readonly ConnectorActionIntent[]>;
  createIntent(scope: WorkspaceScope, input: CreateConnectorIntentInput): Promise<ConnectorActionIntent>;
  editIntent(scope: WorkspaceScope, input: EditConnectorIntentInput): Promise<ConnectorActionIntent>;
  approveIntent(scope: WorkspaceScope, input: DecideConnectorIntentInput): Promise<ApproveConnectorIntentResult>;
  rejectIntent(scope: WorkspaceScope, input: DecideConnectorIntentInput): Promise<ConnectorActionIntent>;
  listJobs(scope: WorkspaceScope, query: ConnectorJobQuery): Promise<readonly ConnectorJob[]>;
  getJob(scope: WorkspaceScope, id: string): Promise<ConnectorJob | undefined>;
  retryJob(
    scope: WorkspaceScope,
    input: { jobId: string; actorMembershipId: string; occurredAt: string },
  ): Promise<ConnectorJob>;
  cancelJob(
    scope: WorkspaceScope,
    input: { jobId: string; actorMembershipId: string; occurredAt: string },
  ): Promise<ConnectorJob>;
  listReceipts(scope: WorkspaceScope, query: ConnectorReceiptQuery): Promise<readonly ConnectorReceipt[]>;
  leaseJobs(scope: WorkspaceScope, input: LeaseConnectorJobsInput): Promise<readonly ConnectorJob[]>;
  beginAttempt(scope: WorkspaceScope, input: BeginConnectorAttemptInput): Promise<ConnectorReceipt>;
  completeJob(scope: WorkspaceScope, input: CompleteConnectorJobInput): Promise<ConnectorJob>;
  deferJob(scope: WorkspaceScope, input: DeferConnectorJobInput): Promise<ConnectorJob>;
  appendReceipt(scope: WorkspaceScope, input: AppendConnectorReceiptInput): Promise<ConnectorReceipt>;
}
