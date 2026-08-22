import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import { randomUUID } from 'node:crypto';
import type {
  ConnectorJobQuery,
  ConnectorReceiptQuery,
  ConnectorRepository,
} from '../data/connector-repository.ts';
import {
  CONNECTOR_JOB_STATES,
  CONNECTOR_LIST_MAX,
  ConnectorError,
  parseConnectorAction,
  parseConnectorIdempotencyKey,
  parseConnectorIdentifier,
  parseConnectorProvider,
  parseConnectorSummary,
  stablePayloadHash,
  type ConnectorJobState,
  type ConnectorProvider,
} from '../domain/connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import { googleRequiredScopeForAction } from '../domain/google-connector.ts';

function sha256(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ConnectorError('invalid-input', `${field} must be a lowercase SHA-256 hash.`);
  }
  return value;
}

function complianceSnapshot(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(value).length > 8_192) {
    throw new ConnectorError('invalid-input', 'complianceSnapshot is invalid.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function instant(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Timestamp is invalid.');
  return now.toISOString();
}

function positiveInteger(value: unknown, label: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ConnectorError('invalid-input', `${label} must be 1–${max}.`);
  }
  return parsed;
}

function requiredPositiveInteger(value: unknown, label: string, max: number): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ConnectorError('invalid-input', `${label} must be 1–${max}.`);
  }
  return parsed;
}

function enabledProvider(
  configuration: ConnectorRuntimeConfiguration,
  value: unknown,
): ConnectorProvider {
  const provider = parseConnectorProvider(value);
  const definition = configuration.definitions.find((candidate) => candidate.provider === provider);
  if (!definition?.enabled) {
    throw new ConnectorError('provider-disabled', `${provider} is not enabled in this deployment.`);
  }
  return provider;
}

function correlationId(value: unknown, fallback: string): string {
  return value === undefined ? fallback : parseConnectorIdentifier(value, 'correlationId');
}

export async function listConnectorDefinitionsCommand(
  repository: ConnectorRepository,
  scope: WorkspaceScope,
) {
  return repository.listDefinitions(validateWorkspaceScope(scope));
}

export async function listConnectorConnectionsCommand(
  repository: ConnectorRepository,
  scope: WorkspaceScope,
  input: { provider?: unknown; limit?: unknown } = {},
) {
  return repository.listConnections(validateWorkspaceScope(scope), {
    ...(input.provider ? { provider: parseConnectorProvider(input.provider) } : {}),
    limit: positiveInteger(input.limit, 'limit', 100, CONNECTOR_LIST_MAX),
  });
}

export async function disconnectConnectorCommand(
  repository: ConnectorRepository,
  scopeInput: WorkspaceScope,
  input: { connectionId?: unknown; correlationId?: unknown },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  return repository.disconnectConnection(scope, {
    connectionId: parseConnectorIdentifier(input.connectionId, 'connectionId'),
    actorMembershipId: scope.membershipId,
    occurredAt: instant(now),
    correlationId: correlationId(input.correlationId, `disconnect:${scope.workspaceId}:${now.getTime()}`),
  });
}

/**
 * Reports the truthful probe capability without simulating provider traffic.
 * Provider stories replace `unsupported` with a receipt-backed safe probe.
 */
export async function probeConnectorConnectionCommand(
  repository: ConnectorRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { connectionId?: unknown },
) {
  const scope = validateWorkspaceScope(scopeInput);
  const connection = await repository.getConnection(
    scope,
    parseConnectorIdentifier(input.connectionId, 'connectionId'),
  );
  if (!connection) throw new ConnectorError('not-found', 'Connector connection was not found.');
  const definition = configuration.definitions.find((item) => item.provider === connection.provider);
  if (!definition || !definition.enabled || definition.mode === 'provider-disabled') {
    return {
      supported: false as const,
      state: 'provider-disabled' as const,
      provider: connection.provider,
      connectionId: connection.id,
    };
  }
  return {
    supported: false as const,
    state: 'probe-unsupported' as const,
    provider: connection.provider,
    connectionId: connection.id,
  };
}

export async function listConnectorIntentsCommand(
  repository: ConnectorRepository,
  scope: WorkspaceScope,
  input: { provider?: unknown; limit?: unknown } = {},
) {
  return repository.listIntents(validateWorkspaceScope(scope), {
    ...(input.provider ? { provider: parseConnectorProvider(input.provider) } : {}),
    limit: positiveInteger(input.limit, 'limit', 100, CONNECTOR_LIST_MAX),
  });
}

export async function createConnectorIntentCommand(
  repository: ConnectorRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    provider?: unknown;
    connectionId?: unknown;
    actionType?: unknown;
    payloadReference?: unknown;
    payload?: unknown;
    payloadHash?: unknown;
    policyId?: unknown;
    policyVersion?: unknown;
    complianceSnapshot?: unknown;
    correlationId?: unknown;
    summary?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const provider = enabledProvider(configuration, input.provider);
  const actionType = parseConnectorAction(input.actionType);
  const definition = configuration.definitions.find((candidate) => candidate.provider === provider);
  if (!definition?.capabilities.includes(actionType)) {
    throw new ConnectorError('forbidden', 'Connector action is not allowlisted for this provider.');
  }
  const connectionId = parseConnectorIdentifier(input.connectionId, 'connectionId');
  const connection = await repository.getConnection(scope, connectionId);
  if (!connection || connection.provider !== provider) {
    throw new ConnectorError('not-found', 'Connector connection was not found for this provider.');
  }
  if (!['active', 'degraded'].includes(connection.status)) {
    throw new ConnectorError('forbidden', 'Connector connection is not available for an action.');
  }
  const requiredScope = provider === 'google'
    ? googleRequiredScopeForAction(actionType)
    : actionType;
  if (!requiredScope || !connection.grantedScopes.includes(requiredScope)) {
    throw new ConnectorError('forbidden', 'Connector connection has not granted this action scope.');
  }
  const payloadReference = parseConnectorIdentifier(input.payloadReference, 'payloadReference');
  return repository.createIntent(scope, {
    provider,
    connectionId,
    actionType,
    payloadReference,
    payloadHash: sha256(input.payloadHash, 'payloadHash')
      ?? stablePayloadHash(input.payload ?? { payloadReference }),
    ...(input.policyId ? { policyId: parseConnectorIdentifier(input.policyId, 'policyId') } : {}),
    ...(input.policyVersion !== undefined ? {
      policyVersion: requiredPositiveInteger(input.policyVersion, 'policyVersion', 10_000),
    } : {}),
    ...(complianceSnapshot(input.complianceSnapshot) ? {
      complianceSnapshot: complianceSnapshot(input.complianceSnapshot),
    } : {}),
    correlationId: input.correlationId
      ? parseConnectorIdentifier(input.correlationId, 'correlationId')
      : randomUUID(),
    summary: parseConnectorSummary(input.summary),
    requestedByMembershipId: scope.membershipId,
    createdAt: instant(now),
  });
}

export async function editConnectorIntentCommand(
  repository: ConnectorRepository,
  scopeInput: WorkspaceScope,
  input: {
    intentId?: unknown;
    expectedVersion?: unknown;
    payloadReference?: unknown;
    payload?: unknown;
    payloadHash?: unknown;
    policyId?: unknown;
    policyVersion?: unknown;
    complianceSnapshot?: unknown;
    correlationId?: unknown;
    summary?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  const expectedVersion = requiredPositiveInteger(input.expectedVersion, 'expectedVersion', 10_000);
  const payloadReference = parseConnectorIdentifier(input.payloadReference, 'payloadReference');
  return repository.editIntent(scope, {
    intentId: parseConnectorIdentifier(input.intentId, 'intentId'),
    expectedVersion,
    payloadReference,
    payloadHash: sha256(input.payloadHash, 'payloadHash')
      ?? stablePayloadHash(input.payload ?? { payloadReference }),
    ...(input.policyId ? { policyId: parseConnectorIdentifier(input.policyId, 'policyId') } : {}),
    ...(input.policyVersion !== undefined ? {
      policyVersion: requiredPositiveInteger(input.policyVersion, 'policyVersion', 10_000),
    } : {}),
    ...(complianceSnapshot(input.complianceSnapshot) ? {
      complianceSnapshot: complianceSnapshot(input.complianceSnapshot),
    } : {}),
    correlationId: input.correlationId
      ? parseConnectorIdentifier(input.correlationId, 'correlationId')
      : randomUUID(),
    summary: parseConnectorSummary(input.summary),
    editedByMembershipId: scope.membershipId,
    editedAt: instant(now),
  });
}

export async function approveConnectorIntentCommand(
  repository: ConnectorRepository,
  scopeInput: WorkspaceScope,
  input: {
    intentId?: unknown;
    expectedVersion?: unknown;
    idempotencyKey?: unknown;
    correlationId?: unknown;
  },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner approval is required.');
  return repository.approveIntent(scope, {
    intentId: parseConnectorIdentifier(input.intentId, 'intentId'),
    expectedVersion: requiredPositiveInteger(input.expectedVersion, 'expectedVersion', 10_000),
    actorMembershipId: scope.membershipId,
    decidedAt: instant(now),
    idempotencyKey: parseConnectorIdempotencyKey(input.idempotencyKey),
    correlationId: correlationId(input.correlationId, `approval:${scope.workspaceId}:${now.getTime()}`),
  });
}

export async function rejectConnectorIntentCommand(
  repository: ConnectorRepository,
  scopeInput: WorkspaceScope,
  input: { intentId?: unknown; expectedVersion?: unknown; correlationId?: unknown },
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner approval is required.');
  return repository.rejectIntent(scope, {
    intentId: parseConnectorIdentifier(input.intentId, 'intentId'),
    expectedVersion: requiredPositiveInteger(input.expectedVersion, 'expectedVersion', 10_000),
    actorMembershipId: scope.membershipId,
    decidedAt: instant(now),
    idempotencyKey: `reject:${scope.workspaceId}:${now.getTime()}`,
    correlationId: correlationId(input.correlationId, `reject:${scope.workspaceId}:${now.getTime()}`),
  });
}

export async function listConnectorJobsCommand(
  repository: ConnectorRepository,
  scope: WorkspaceScope,
  input: { provider?: unknown; state?: unknown; limit?: unknown } = {},
) {
  if (input.state !== undefined && input.state !== 'all'
    && !CONNECTOR_JOB_STATES.includes(input.state as ConnectorJobState)) {
    throw new ConnectorError('invalid-input', 'Connector job state is invalid.');
  }
  const query: ConnectorJobQuery = {
    ...(input.provider ? { provider: parseConnectorProvider(input.provider) } : {}),
    ...(input.state ? { state: input.state as ConnectorJobState | 'all' } : {}),
    limit: positiveInteger(input.limit, 'limit', 100, CONNECTOR_LIST_MAX),
  };
  return repository.listJobs(validateWorkspaceScope(scope), query);
}

export async function listConnectorReceiptsCommand(
  repository: ConnectorRepository,
  scope: WorkspaceScope,
  input: { provider?: unknown; jobId?: unknown; intentId?: unknown; limit?: unknown } = {},
) {
  const query: ConnectorReceiptQuery = {
    ...(input.provider ? { provider: parseConnectorProvider(input.provider) } : {}),
    ...(input.jobId ? { jobId: parseConnectorIdentifier(input.jobId, 'jobId') } : {}),
    ...(input.intentId ? { intentId: parseConnectorIdentifier(input.intentId, 'intentId') } : {}),
    limit: positiveInteger(input.limit, 'limit', 100, CONNECTOR_LIST_MAX),
  };
  return repository.listReceipts(validateWorkspaceScope(scope), query);
}

export async function retryConnectorJobCommand(
  repository: ConnectorRepository,
  scopeInput: WorkspaceScope,
  jobId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  return repository.retryJob(scope, {
    jobId: parseConnectorIdentifier(jobId, 'jobId'),
    actorMembershipId: scope.membershipId,
    occurredAt: instant(now),
  });
}

export async function cancelConnectorJobCommand(
  repository: ConnectorRepository,
  scopeInput: WorkspaceScope,
  jobId: unknown,
  now = new Date(),
) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Workspace owner access is required.');
  return repository.cancelJob(scope, {
    jobId: parseConnectorIdentifier(jobId, 'jobId'),
    actorMembershipId: scope.membershipId,
    occurredAt: instant(now),
  });
}
