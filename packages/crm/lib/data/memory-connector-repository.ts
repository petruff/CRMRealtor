import {
  CONNECTOR_LIST_MAX,
  ConnectorError,
  redactConnectorDetail,
  stablePayloadHash,
  type ConnectorActionIntent,
  type ConnectorConnection,
  type ConnectorDefinition,
  type ConnectorJob,
  type ConnectorReceipt,
} from '../domain/connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type {
  AppendConnectorReceiptInput,
  ApproveConnectorIntentResult,
  ConnectorRepository,
} from './connector-repository.ts';

interface MemoryConnectorRepositoryOptions {
  readonly definitions: readonly ConnectorDefinition[];
  readonly initialConnections?: readonly ConnectorConnection[];
  readonly initialIntents?: readonly ConnectorActionIntent[];
  readonly initialJobs?: readonly ConnectorJob[];
  readonly initialReceipts?: readonly ConnectorReceipt[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function authorize(scope: WorkspaceScope): WorkspaceScope {
  return validateWorkspaceScope(scope);
}

function owner(scope: WorkspaceScope): WorkspaceScope {
  const valid = authorize(scope);
  if (valid.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  return valid;
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > CONNECTOR_LIST_MAX) {
    throw new ConnectorError('invalid-input', `limit must be 1–${CONNECTOR_LIST_MAX}.`);
  }
  return value;
}

function eligibleRetry(state: ConnectorJob['state']): boolean {
  return state === 'failed' || state === 'dead-letter' || state === 'reconciliation-required';
}

function eligibleCancel(state: ConnectorJob['state']): boolean {
  return state === 'queued' || state === 'retry-scheduled' || state === 'reconciliation-required';
}

export function createMemoryConnectorRepository(
  options: MemoryConnectorRepositoryOptions,
): ConnectorRepository {
  const definitions = options.definitions.map(clone);
  const connections = (options.initialConnections ?? []).map(clone);
  const intents = (options.initialIntents ?? []).map(clone);
  const jobs = (options.initialJobs ?? []).map(clone);
  const receipts = (options.initialReceipts ?? []).map(clone);
  const approvalReplays = new Map<string, { fingerprint: string; result: ApproveConnectorIntentResult }>();
  let intentSequence = intents.length + 1;
  let jobSequence = jobs.length + 1;
  let receiptSequence = receipts.length + 1;

  const receipt = (scope: WorkspaceScope, input: AppendConnectorReceiptInput): ConnectorReceipt => {
    const event: ConnectorReceipt = {
      id: `connector-receipt-${String(receiptSequence++).padStart(4, '0')}`,
      workspaceId: scope.workspaceId,
      provider: input.provider,
      ...(input.intentId ? { intentId: input.intentId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.attemptNumber !== undefined ? { attemptNumber: input.attemptNumber } : {}),
      type: input.type,
      correlationId: input.correlationId,
      ...(input.actorMembershipId ? { actorMembershipId: input.actorMembershipId } : {}),
      ...(input.requestHash ? { requestHash: input.requestHash } : {}),
      ...(input.providerReceiptId ? { providerReceiptId: input.providerReceiptId } : {}),
      ...(input.providerStatus ? { providerStatus: input.providerStatus } : {}),
      errorCategory: input.errorCategory,
      ...(redactConnectorDetail(input.detail) ? { detail: redactConnectorDetail(input.detail) } : {}),
      occurredAt: input.occurredAt,
    };
    receipts.push(event);
    return clone(event);
  };

  const scopedIntent = (scope: WorkspaceScope, id: string): ConnectorActionIntent => {
    const intent = intents.find((candidate) => candidate.id === id && candidate.workspaceId === scope.workspaceId);
    if (!intent) throw new ConnectorError('not-found', 'Connector intent was not found.');
    return intent;
  };

  const scopedJob = (scope: WorkspaceScope, id: string): ConnectorJob => {
    const job = jobs.find((candidate) => candidate.id === id && candidate.workspaceId === scope.workspaceId);
    if (!job) throw new ConnectorError('not-found', 'Connector job was not found.');
    return job;
  };

  const replaceIntent = (next: ConnectorActionIntent): void => {
    const index = intents.findIndex((intent) => intent.id === next.id);
    if (index < 0) throw new ConnectorError('not-found', 'Connector intent was not found.');
    intents[index] = next;
  };

  const replaceJob = (next: ConnectorJob): void => {
    const index = jobs.findIndex((job) => job.id === next.id);
    if (index < 0) throw new ConnectorError('not-found', 'Connector job was not found.');
    jobs[index] = next;
  };

  return {
    async listDefinitions(scope) {
      authorize(scope);
      return definitions.map(clone);
    },

    async listConnections(scope, query) {
      const valid = authorize(scope);
      const limit = boundedLimit(query.limit);
      return connections
        .filter((connection) => connection.workspaceId === valid.workspaceId)
        .filter((connection) => !query.provider || connection.provider === query.provider)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(clone);
    },

    async getConnection(scope, id) {
      const valid = authorize(scope);
      const connection = connections.find((candidate) => (
        candidate.workspaceId === valid.workspaceId && candidate.id === id
      ));
      return connection ? clone(connection) : undefined;
    },

    async disconnectConnection(scope, input) {
      const valid = owner(scope);
      if (input.actorMembershipId !== valid.membershipId) {
        throw new ConnectorError('forbidden', 'Connector actor does not match the active membership.');
      }
      const index = connections.findIndex((candidate) => (
        candidate.workspaceId === valid.workspaceId && candidate.id === input.connectionId
      ));
      const current = connections[index];
      if (!current) throw new ConnectorError('not-found', 'Connector connection was not found.');
      const noOp = current.status === 'revoking'
        || current.status === 'disconnected' || current.status === 'disconnected-unconfirmed';
      const next: ConnectorConnection = noOp ? current : {
        ...current,
        status: 'revoking',
        updatedAt: input.occurredAt,
      };
      connections[index] = next;
      const event = receipt(valid, {
        provider: next.provider,
        type: 'revocation.requested',
        correlationId: input.correlationId,
        actorMembershipId: valid.membershipId,
        errorCategory: 'none',
        detail: noOp ? 'Connection revocation was already requested or completed.' : 'Provider revocation was queued before local cryptographic destruction.',
        occurredAt: input.occurredAt,
      });
      return { connection: clone(next), receipt: event, noOp };
    },

    async listIntents(scope, query) {
      const valid = authorize(scope);
      return intents
        .filter((intent) => intent.workspaceId === valid.workspaceId)
        .filter((intent) => !query.provider || intent.provider === query.provider)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, boundedLimit(query.limit))
        .map(clone);
    },

    async createIntent(scope, input) {
      const valid = authorize(scope);
      if (input.requestedByMembershipId !== valid.membershipId) {
        throw new ConnectorError('forbidden', 'Connector actor does not match the active membership.');
      }
      const intent: ConnectorActionIntent = {
        id: `connector-intent-${String(intentSequence++).padStart(4, '0')}`,
        workspaceId: valid.workspaceId,
        provider: input.provider,
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        actionType: input.actionType,
        version: 1,
        payloadReference: input.payloadReference,
        payloadHash: input.payloadHash,
        summary: input.summary,
        status: 'pending',
        requestedByMembershipId: valid.membershipId,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      intents.push(intent);
      receipt(valid, {
        provider: intent.provider,
        intentId: intent.id,
        type: 'intent.created',
        correlationId: `intent:${intent.id}:v1`,
        actorMembershipId: valid.membershipId,
        errorCategory: 'none',
        occurredAt: input.createdAt,
      });
      return clone(intent);
    },

    async editIntent(scope, input) {
      const valid = authorize(scope);
      if (input.editedByMembershipId !== valid.membershipId) {
        throw new ConnectorError('forbidden', 'Connector actor does not match the active membership.');
      }
      const current = scopedIntent(valid, input.intentId);
      if (current.version !== input.expectedVersion) {
        throw new ConnectorError('conflict', 'Connector intent version changed; review it again.');
      }
      if (!['pending', 'editing', 'rejected', 'failed'].includes(current.status)) {
        throw new ConnectorError('conflict', 'Connector intent can no longer be edited.');
      }
      const next: ConnectorActionIntent = {
        ...current,
        version: current.version + 1,
        payloadReference: input.payloadReference,
        payloadHash: input.payloadHash,
        summary: input.summary,
        status: 'pending',
        approvedByMembershipId: undefined,
        approvedAt: undefined,
        rejectedAt: undefined,
        updatedAt: input.editedAt,
      };
      replaceIntent(next);
      receipt(valid, {
        provider: next.provider,
        intentId: next.id,
        type: 'intent.edited',
        correlationId: `intent:${next.id}:v${next.version}`,
        actorMembershipId: valid.membershipId,
        requestHash: next.payloadHash,
        errorCategory: 'none',
        occurredAt: input.editedAt,
      });
      return clone(next);
    },

    async approveIntent(scope, input) {
      const valid = owner(scope);
      if (input.actorMembershipId !== valid.membershipId) {
        throw new ConnectorError('forbidden', 'Connector approver does not match the active membership.');
      }
      const current = scopedIntent(valid, input.intentId);
      const replayKey = `${valid.workspaceId}:${input.idempotencyKey}`;
      const fingerprint = stablePayloadHash({ intentId: current.id, version: input.expectedVersion });
      const replay = approvalReplays.get(replayKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint) {
          throw new ConnectorError('conflict', 'Approval idempotency key was reused with different data.');
        }
        return clone({ ...replay.result, noOp: true });
      }
      if (current.version !== input.expectedVersion || current.status !== 'pending') {
        throw new ConnectorError('conflict', 'Connector intent is not the pending version reviewed by the owner.');
      }
      const existing = jobs.find((job) => job.intentId === current.id && job.intentVersion === current.version);
      if (existing) throw new ConnectorError('conflict', 'Connector intent already has an execution job.');
      const approved: ConnectorActionIntent = {
        ...current,
        status: 'queued',
        approvedByMembershipId: valid.membershipId,
        approvedAt: input.decidedAt,
        updatedAt: input.decidedAt,
      };
      const job: ConnectorJob = {
        id: `connector-job-${String(jobSequence++).padStart(4, '0')}`,
        workspaceId: valid.workspaceId,
        intentId: approved.id,
        intentVersion: approved.version,
        provider: approved.provider,
        actionType: approved.actionType,
        payloadReference: approved.payloadReference,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        state: 'queued',
        attemptCount: 0,
        maxAttempts: 5,
        scheduledAt: input.decidedAt,
        fencingToken: 0,
        createdAt: input.decidedAt,
        updatedAt: input.decidedAt,
      };
      replaceIntent(approved);
      jobs.push(job);
      receipt(valid, {
        provider: approved.provider,
        intentId: approved.id,
        jobId: job.id,
        type: 'intent.approved',
        correlationId: input.correlationId,
        actorMembershipId: valid.membershipId,
        requestHash: approved.payloadHash,
        errorCategory: 'none',
        occurredAt: input.decidedAt,
      });
      const queuedReceipt = receipt(valid, {
        provider: approved.provider,
        intentId: approved.id,
        jobId: job.id,
        type: 'job.queued',
        correlationId: input.correlationId,
        actorMembershipId: valid.membershipId,
        requestHash: approved.payloadHash,
        errorCategory: 'none',
        occurredAt: input.decidedAt,
      });
      const result = { intent: clone(approved), job: clone(job), receipt: queuedReceipt, noOp: false };
      approvalReplays.set(replayKey, { fingerprint, result: clone(result) });
      return result;
    },

    async rejectIntent(scope, input) {
      const valid = owner(scope);
      if (input.actorMembershipId !== valid.membershipId) {
        throw new ConnectorError('forbidden', 'Connector approver does not match the active membership.');
      }
      const current = scopedIntent(valid, input.intentId);
      if (current.version !== input.expectedVersion || current.status !== 'pending') {
        throw new ConnectorError('conflict', 'Connector intent is not the pending version reviewed by the owner.');
      }
      const next: ConnectorActionIntent = {
        ...current,
        status: 'rejected',
        rejectedAt: input.decidedAt,
        updatedAt: input.decidedAt,
      };
      replaceIntent(next);
      receipt(valid, {
        provider: next.provider,
        intentId: next.id,
        type: 'intent.rejected',
        correlationId: input.correlationId,
        actorMembershipId: valid.membershipId,
        requestHash: next.payloadHash,
        errorCategory: 'none',
        occurredAt: input.decidedAt,
      });
      return clone(next);
    },

    async listJobs(scope, query) {
      const valid = authorize(scope);
      return jobs
        .filter((job) => job.workspaceId === valid.workspaceId)
        .filter((job) => !query.provider || job.provider === query.provider)
        .filter((job) => !query.state || query.state === 'all' || job.state === query.state)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, boundedLimit(query.limit))
        .map(clone);
    },

    async getJob(scope, id) {
      const valid = authorize(scope);
      const job = jobs.find((candidate) => candidate.workspaceId === valid.workspaceId && candidate.id === id);
      return job ? clone(job) : undefined;
    },

    async retryJob(scope, input) {
      const valid = owner(scope);
      if (input.actorMembershipId !== valid.membershipId) throw new ConnectorError('forbidden', 'Owner access is required.');
      const current = scopedJob(valid, input.jobId);
      if (!eligibleRetry(current.state)) throw new ConnectorError('conflict', 'Connector job is not eligible for retry.');
      const next: ConnectorJob = {
        ...current,
        state: 'queued',
        scheduledAt: input.occurredAt,
        nextRetryAt: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: input.occurredAt,
      };
      replaceJob(next);
      return clone(next);
    },

    async cancelJob(scope, input) {
      const valid = owner(scope);
      if (input.actorMembershipId !== valid.membershipId) throw new ConnectorError('forbidden', 'Owner access is required.');
      const current = scopedJob(valid, input.jobId);
      if (!eligibleCancel(current.state)) throw new ConnectorError('conflict', 'Connector job is not eligible for cancellation.');
      const next: ConnectorJob = {
        ...current,
        state: 'cancelled',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        completedAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };
      replaceJob(next);
      const intent = scopedIntent(valid, current.intentId);
      replaceIntent({ ...intent, status: 'cancelled', updatedAt: input.occurredAt });
      receipt(valid, {
        provider: current.provider,
        intentId: current.intentId,
        jobId: current.id,
        type: 'job.cancelled',
        correlationId: current.correlationId,
        actorMembershipId: valid.membershipId,
        errorCategory: 'none',
        occurredAt: input.occurredAt,
      });
      return clone(next);
    },

    async listReceipts(scope, query) {
      const valid = authorize(scope);
      return receipts
        .filter((event) => event.workspaceId === valid.workspaceId)
        .filter((event) => !query.provider || event.provider === query.provider)
        .filter((event) => !query.jobId || event.jobId === query.jobId)
        .filter((event) => !query.intentId || event.intentId === query.intentId)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, boundedLimit(query.limit))
        .map(clone);
    },

    async leaseJobs(scope, input) {
      const valid = owner(scope);
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25) {
        throw new ConnectorError('invalid-input', 'Worker batch must be 1–25.');
      }
      if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30 || input.leaseSeconds > 600) {
        throw new ConnectorError('invalid-input', 'Worker lease must be 30–600 seconds.');
      }
      const nowMs = new Date(input.now).getTime();
      const allowed = input.states ?? ['queued', 'retry-scheduled', 'reconciliation-required'];
      const due = jobs
        .filter((job) => job.workspaceId === valid.workspaceId)
        .filter((job) => allowed.includes(job.state as typeof allowed[number]))
        .filter((job) => new Date(job.nextRetryAt ?? job.scheduledAt).getTime() <= nowMs)
        .filter((job) => !job.leaseExpiresAt || new Date(job.leaseExpiresAt).getTime() <= nowMs)
        .sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt))
        .slice(0, input.limit);
      return due.map((current) => {
        const next: ConnectorJob = {
          ...current,
          state: 'leased',
          leaseOwner: input.workerId,
          leaseExpiresAt: new Date(nowMs + input.leaseSeconds * 1_000).toISOString(),
          fencingToken: current.fencingToken + 1,
          updatedAt: input.now,
        };
        replaceJob(next);
        return clone(next);
      });
    },

    async beginAttempt(scope, input) {
      const valid = owner(scope);
      const current = scopedJob(valid, input.jobId);
      if (current.state !== 'leased'
        || current.leaseOwner !== input.workerId
        || current.fencingToken !== input.fencingToken
        || !current.leaseExpiresAt
        || current.leaseExpiresAt <= input.occurredAt) {
        throw new ConnectorError('lease-lost', 'Connector job lease is no longer valid.');
      }
      const next: ConnectorJob = {
        ...current,
        state: 'executing',
        attemptCount: current.attemptCount + 1,
        updatedAt: input.occurredAt,
      };
      replaceJob(next);
      const intent = scopedIntent(valid, current.intentId);
      replaceIntent({ ...intent, status: 'executing', updatedAt: input.occurredAt });
      return receipt(valid, {
        provider: current.provider,
        intentId: current.intentId,
        jobId: current.id,
        attemptNumber: next.attemptCount,
        type: 'attempt.started',
        correlationId: current.correlationId,
        requestHash: stablePayloadHash({
          provider: current.provider,
          actionType: current.actionType,
          payloadReference: current.payloadReference,
          idempotencyKey: current.idempotencyKey,
        }),
        errorCategory: 'none',
        occurredAt: input.occurredAt,
      });
    },

    async completeJob(scope, input) {
      const valid = owner(scope);
      const current = scopedJob(valid, input.jobId);
      if (current.state !== 'executing'
        || current.leaseOwner !== input.workerId
        || current.fencingToken !== input.fencingToken) {
        throw new ConnectorError('lease-lost', 'Connector job lease is no longer valid.');
      }
      receipt(valid, {
        provider: current.provider,
        intentId: current.intentId,
        jobId: current.id,
        attemptNumber: current.attemptCount,
        type: 'provider.accepted',
        correlationId: current.correlationId,
        requestHash: input.requestHash,
        providerReceiptId: input.providerReceiptId,
        providerStatus: input.providerStatus,
        errorCategory: 'none',
        occurredAt: input.occurredAt,
      });
      receipt(valid, {
        provider: current.provider,
        intentId: current.intentId,
        jobId: current.id,
        attemptNumber: current.attemptCount,
        type: 'provider.final',
        correlationId: current.correlationId,
        requestHash: input.requestHash,
        providerReceiptId: input.providerReceiptId,
        providerStatus: input.providerStatus,
        errorCategory: 'none',
        occurredAt: input.occurredAt,
      });
      const next: ConnectorJob = {
        ...current,
        state: 'succeeded',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: input.occurredAt,
        completedAt: input.occurredAt,
      };
      replaceJob(next);
      const intent = scopedIntent(valid, current.intentId);
      replaceIntent({ ...intent, status: 'succeeded', updatedAt: input.occurredAt });
      return clone(next);
    },

    async deferJob(scope, input) {
      const valid = owner(scope);
      const current = scopedJob(valid, input.jobId);
      if ((current.state !== 'executing' && current.state !== 'leased')
        || current.leaseOwner !== input.workerId
        || current.fencingToken !== input.fencingToken) {
        throw new ConnectorError('lease-lost', 'Connector job lease is no longer valid.');
      }
      const unknown = input.errorCategory === 'network_outcome_unknown'
        || input.errorCategory === 'provider_acceptance_unknown';
      const retryable = input.errorCategory === 'provider_unavailable'
        || input.errorCategory === 'rate_limited'
        || input.errorCategory === 'network_not_sent';
      const exhausted = retryable && current.attemptCount >= current.maxAttempts;
      const state: ConnectorJob['state'] = unknown
        ? 'reconciliation-required'
        : retryable && !exhausted
          ? 'retry-scheduled'
          : exhausted
            ? 'dead-letter'
            : 'failed';
      const type = unknown ? 'provider.unknown' : retryable && !exhausted ? 'job.retry-scheduled' : 'job.failed';
      receipt(valid, {
        provider: current.provider,
        intentId: current.intentId,
        jobId: current.id,
        attemptNumber: current.attemptCount,
        type,
        correlationId: current.correlationId,
        errorCategory: input.errorCategory,
        detail: input.detail,
        occurredAt: input.occurredAt,
      });
      const next: ConnectorJob = {
        ...current,
        state,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        ...(input.nextAttemptAt ? { nextRetryAt: input.nextAttemptAt } : {}),
        updatedAt: input.occurredAt,
        ...((state === 'failed' || state === 'dead-letter') ? { completedAt: input.occurredAt } : {}),
      };
      replaceJob(next);
      const intent = scopedIntent(valid, current.intentId);
      replaceIntent({
        ...intent,
        status: state === 'failed' || state === 'dead-letter' ? 'failed' : 'queued',
        updatedAt: input.occurredAt,
      });
      return clone(next);
    },

    async appendReceipt(scope, input) {
      const valid = authorize(scope);
      return receipt(valid, input);
    },
  };
}
