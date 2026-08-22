import { createHash, randomUUID } from 'node:crypto';
import type { ConnectorRuntimeConfiguration } from '../config/connector-runtime.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import type { ContactOutboundGuard } from '../data/contact-outbound-guard.ts';
import type { GoogleOperationRepository } from '../data/google-operation-repository.ts';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import { createGoogleRawTextMessage } from '../domain/google-connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import {
  createEnvironmentKekResolver,
  encryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import { createConnectorIntentCommand } from './connector-commands.ts';

function enabledGoogle(configuration: ConnectorRuntimeConfiguration) {
  const definition = configuration.definitions.find((item) => item.provider === 'google');
  if (!definition?.enabled || !['uat', 'live'].includes(definition.mode)) {
    throw new ConnectorError('provider-disabled', 'Google is not enabled in this deployment.');
  }
}

function liveScope(scopeInput: WorkspaceScope) {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.mode !== 'live') throw new ConnectorError('forbidden', 'Live workspace authority is required.');
  return scope;
}

export async function prepareGoogleGmailSendIntent(
  connectorRepository: ConnectorRepository,
  operations: GoogleOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly contactId: string;
    readonly contactPointId: string;
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly body: string;
    readonly correlationId?: string;
  },
  dependencies: {
    readonly resolver?: ConnectorKekResolver;
    readonly outboundGuard: ContactOutboundGuard;
  },
  now = new Date(),
) {
  const scope = liveScope(scopeInput);
  enabledGoogle(configuration);
  const reviewedTarget = await dependencies.outboundGuard.assertTarget(
    scope,
    input.contactId,
    input.contactPointId,
  );
  const correlationId = input.correlationId ?? randomUUID();
  const clientMessageId = `${stablePayloadHash({
    workspaceId: scope.workspaceId, connectionId: input.connectionId,
    contactId: input.contactId, contactPointId: input.contactPointId, correlationId,
  })}@omnix.local`;
  const rawMessageBase64Url = createGoogleRawTextMessage({ ...input, clientMessageId });
  const payload = {
    schemaVersion: 'google-gmail-send.v1', contactId: input.contactId,
    contactPointId: input.contactPointId, aliasEpoch: reviewedTarget.aliasEpoch,
    normalizedRecipient: input.to.trim().toLowerCase(),
    clientMessageId, rawMessageBase64Url,
  };
  const payloadHash = stablePayloadHash(payload);
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify(payload), {
    workspaceId: scope.workspaceId, connectionId: input.connectionId,
    provider: 'google', secretType: 'gmail.send', recordVersion: 1,
  }, resolver);
  const stored = await operations.storeEncryptedPayload(scope, {
    connectionId: input.connectionId, payloadKind: 'gmail.send',
    schemaVersion: 'google-gmail-send.v1', canonicalHash: payloadHash, envelope,
  });
  const policy = await operations.ensurePolicy(scope, {
    actionType: 'gmail.send', correlationId, occurredAt: now.toISOString(),
  });
  return createConnectorIntentCommand(connectorRepository, configuration, scope, {
    provider: 'google', connectionId: input.connectionId, actionType: 'gmail.send',
    payloadReference: stored.payloadReference, payloadHash: stored.payloadHash,
    policyId: policy.id, policyVersion: policy.version, correlationId,
    summary: `Send reviewed email to contact ${input.contactId}.`,
    complianceSnapshot: {
      contactId: input.contactId, contactPointId: input.contactPointId,
      aliasEpoch: reviewedTarget.aliasEpoch,
      recipientHash: createHash('sha256').update(input.to.trim().toLowerCase()).digest('hex'),
      contentHash: payloadHash, bodyInReceipt: false,
    },
  }, now);
}

export async function prepareGoogleCalendarCreationIntent(
  connectorRepository: ConnectorRepository,
  operations: GoogleOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: { readonly connectionId: string; readonly correlationId?: string },
  dependencies: { readonly resolver?: ConnectorKekResolver } = {},
  now = new Date(),
) {
  const scope = liveScope(scopeInput);
  enabledGoogle(configuration);
  const correlationId = input.correlationId ?? randomUUID();
  const resourceKeyHash = stablePayloadHash({
    workspaceId: scope.workspaceId,
    connectionId: input.connectionId,
    resource: 'omnix-calendar',
  });
  const payload = { schemaVersion: 'google-calendar-create.v1', name: 'Omnix CRM', resourceKeyHash };
  const payloadHash = stablePayloadHash(payload);
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify(payload), {
    workspaceId: scope.workspaceId, connectionId: input.connectionId,
    provider: 'google', secretType: 'calendar.create-omnix-calendar', recordVersion: 1,
  }, resolver);
  const stored = await operations.storeEncryptedPayload(scope, {
    connectionId: input.connectionId, payloadKind: 'calendar.create-omnix-calendar',
    schemaVersion: 'google-calendar-create.v1', canonicalHash: payloadHash, envelope,
  });
  const policy = await operations.ensurePolicy(scope, {
    actionType: 'calendar.create-omnix-calendar', correlationId, occurredAt: now.toISOString(),
  });
  return createConnectorIntentCommand(connectorRepository, configuration, scope, {
    provider: 'google', connectionId: input.connectionId,
    actionType: 'calendar.create-omnix-calendar',
    payloadReference: stored.payloadReference, payloadHash: stored.payloadHash,
    policyId: policy.id, policyVersion: policy.version, correlationId,
    summary: 'Create the dedicated Omnix CRM calendar.',
    complianceSnapshot: { resourceKeyHash, primaryCalendar: false },
  }, now);
}

export async function prepareGoogleSyncIntent(
  connectorRepository: ConnectorRepository,
  operations: GoogleOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly actionType: 'gmail.sync-metadata' | 'calendar.sync';
    readonly correlationId?: string;
  },
  dependencies: { readonly resolver?: ConnectorKekResolver } = {},
  now = new Date(),
) {
  const scope = liveScope(scopeInput);
  enabledGoogle(configuration);
  const correlationId = input.correlationId ?? randomUUID();
  const payload = {
    schemaVersion: 'google-sync.v1', actionType: input.actionType,
    requestedAt: now.toISOString(), bound: input.actionType === 'gmail.sync-metadata' ? 500 : 500,
  };
  const payloadHash = stablePayloadHash(payload);
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify(payload), {
    workspaceId: scope.workspaceId, connectionId: input.connectionId,
    provider: 'google', secretType: input.actionType, recordVersion: 1,
  }, resolver);
  const stored = await operations.storeEncryptedPayload(scope, {
    connectionId: input.connectionId, payloadKind: input.actionType,
    schemaVersion: 'google-sync.v1', canonicalHash: payloadHash, envelope,
  });
  const policy = await operations.ensurePolicy(scope, {
    actionType: input.actionType, correlationId, occurredAt: now.toISOString(),
  });
  return createConnectorIntentCommand(connectorRepository, configuration, scope, {
    provider: 'google', connectionId: input.connectionId, actionType: input.actionType,
    payloadReference: stored.payloadReference, payloadHash: stored.payloadHash,
    policyId: policy.id, policyVersion: policy.version, correlationId,
    summary: input.actionType === 'gmail.sync-metadata'
      ? 'Synchronize bounded Gmail activity metadata.'
      : 'Reconcile the dedicated Omnix Calendar.',
    complianceSnapshot: {
      metadataOnly: input.actionType === 'gmail.sync-metadata',
      bodyRequested: false, primaryCalendar: false, boundedPageSize: 500,
    },
  }, now);
}

export async function prepareGoogleCalendarTaskIntent(
  connectorRepository: ConnectorRepository,
  operations: GoogleOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly taskId: string;
    readonly taskVersion: number;
    readonly title: string;
    readonly startAt: string;
    readonly endAt: string;
    readonly timeZone: string;
    readonly eventId?: string;
    readonly correlationId?: string;
  },
  dependencies: { readonly resolver?: ConnectorKekResolver } = {},
  now = new Date(),
) {
  const scope = liveScope(scopeInput);
  enabledGoogle(configuration);
  try { new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(now); }
  catch { throw new ConnectorError('invalid-input', 'Task timezone is invalid.'); }
  if (!Number.isInteger(input.taskVersion) || input.taskVersion < 1
    || !Number.isFinite(new Date(input.startAt).getTime()) || !Number.isFinite(new Date(input.endAt).getTime())
    || new Date(input.endAt) <= new Date(input.startAt)) {
    throw new ConnectorError('invalid-input', 'Task calendar payload is invalid.');
  }
  const resourceKey = stablePayloadHash({ workspaceId: scope.workspaceId, taskId: input.taskId });
  const eventId = input.eventId ?? resourceKey.slice(0, 32);
  const payload = {
    schemaVersion: 'google-calendar-task.v1', taskId: input.taskId,
    taskVersion: input.taskVersion, resourceKey, title: input.title,
    startAt: new Date(input.startAt).toISOString(), endAt: new Date(input.endAt).toISOString(),
    timeZone: input.timeZone, eventId,
  };
  const payloadHash = stablePayloadHash(payload);
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify(payload), {
    workspaceId: scope.workspaceId, connectionId: input.connectionId,
    provider: 'google', secretType: 'calendar.upsert-omnix-event', recordVersion: 1,
  }, resolver);
  const stored = await operations.storeEncryptedPayload(scope, {
    connectionId: input.connectionId, payloadKind: 'calendar.upsert-omnix-event',
    schemaVersion: 'google-calendar-task.v1', canonicalHash: payloadHash, envelope,
  });
  const correlationId = input.correlationId ?? randomUUID();
  const policy = await operations.ensurePolicy(scope, {
    actionType: 'calendar.upsert-omnix-event', correlationId, occurredAt: now.toISOString(),
  });
  return createConnectorIntentCommand(connectorRepository, configuration, scope, {
    provider: 'google', connectionId: input.connectionId,
    actionType: 'calendar.upsert-omnix-event',
    payloadReference: stored.payloadReference, payloadHash: stored.payloadHash,
    policyId: policy.id, policyVersion: policy.version, correlationId,
    summary: `Synchronize task ${input.taskId} with the Omnix Calendar.`,
    complianceSnapshot: { taskId: input.taskId, taskVersion: input.taskVersion, resourceKey, timeZone: input.timeZone },
  }, now);
}

export async function prepareGoogleCalendarTaskLifecycleIntent(
  connectorRepository: ConnectorRepository,
  operations: GoogleOperationRepository,
  configuration: ConnectorRuntimeConfiguration,
  scopeInput: WorkspaceScope,
  input: {
    readonly connectionId: string;
    readonly taskId: string;
    readonly taskVersion: number;
    readonly taskStatus: 'completed' | 'archived';
    readonly lifecycle: 'complete' | 'cancel' | 'delete';
    readonly eventId?: string;
    readonly correlationId?: string;
  },
  dependencies: { readonly resolver?: ConnectorKekResolver } = {},
  now = new Date(),
) {
  const scope = liveScope(scopeInput);
  enabledGoogle(configuration);
  if (!Number.isInteger(input.taskVersion) || input.taskVersion < 1
    || (input.taskStatus === 'completed' && input.lifecycle !== 'complete')
    || (input.taskStatus === 'archived' && !['cancel', 'delete'].includes(input.lifecycle))) {
    throw new ConnectorError('invalid-input', 'Task lifecycle and canonical state do not match.');
  }
  const resourceKey = stablePayloadHash({ workspaceId: scope.workspaceId, taskId: input.taskId });
  const eventId = input.eventId ?? resourceKey.slice(0, 32);
  const actionType = `calendar.${input.lifecycle}-omnix-event` as const;
  const payload = {
    schemaVersion: 'google-calendar-task-lifecycle.v1', actionType,
    taskId: input.taskId, taskVersion: input.taskVersion, taskStatus: input.taskStatus,
    resourceKey, eventId,
  };
  const payloadHash = stablePayloadHash(payload);
  const resolver = dependencies.resolver ?? createEnvironmentKekResolver();
  const envelope = encryptConnectorSecret(JSON.stringify(payload), {
    workspaceId: scope.workspaceId, connectionId: input.connectionId,
    provider: 'google', secretType: actionType, recordVersion: 1,
  }, resolver);
  const stored = await operations.storeEncryptedPayload(scope, {
    connectionId: input.connectionId, payloadKind: actionType,
    schemaVersion: payload.schemaVersion, canonicalHash: payloadHash, envelope,
  });
  const correlationId = input.correlationId ?? randomUUID();
  const policy = await operations.ensurePolicy(scope, {
    actionType, correlationId, occurredAt: now.toISOString(),
  });
  return createConnectorIntentCommand(connectorRepository, configuration, scope, {
    provider: 'google', connectionId: input.connectionId, actionType,
    payloadReference: stored.payloadReference, payloadHash: stored.payloadHash,
    policyId: policy.id, policyVersion: policy.version, correlationId,
    summary: `${input.lifecycle[0]!.toUpperCase()}${input.lifecycle.slice(1)} the Omnix-owned event for task ${input.taskId}.`,
    complianceSnapshot: {
      taskId: input.taskId, taskVersion: input.taskVersion, taskStatus: input.taskStatus,
      resourceKey, primaryCalendar: false, exactBoundEventOnly: true,
    },
  }, now);
}
