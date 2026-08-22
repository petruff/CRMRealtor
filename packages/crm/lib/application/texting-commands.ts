import { randomUUID } from 'node:crypto';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import {
  parseE164Phone,
  parseTextMessageBody,
  parseTextingUseCase,
  type TextingConsentStatus,
} from '../domain/texting.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { TwilioOperationRepository } from '../data/twilio-operation-repository.ts';
import type { ContactOutboundGuard } from '../data/contact-outbound-guard.ts';

function required(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', `${field} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

function uuid(value: unknown, field: string): string {
  const clean = required(value, field, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

function live(scopeInput: WorkspaceScope): WorkspaceScope {
  const scope = validateWorkspaceScope(scopeInput);
  if (scope.mode !== 'live') throw new ConnectorError('forbidden', 'Texting provider operations require a live workspace.');
  return scope;
}

function verifiedTimeZone(value: unknown): string {
  const timeZone = required(value, 'recipientTimeZone', 120);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new ConnectorError('invalid-input', 'recipientTimeZone must be a valid IANA timezone.');
  }
  return timeZone;
}

export async function readTextingReadinessCommand(
  repository: TwilioOperationRepository,
  scope: WorkspaceScope,
  connectionId: unknown,
) {
  return repository.readReadiness(live(scope), uuid(connectionId, 'connectionId'));
}

export async function readContactTextingSummaryCommand(
  repository: TwilioOperationRepository,
  scope: WorkspaceScope,
  input: { readonly connectionId: unknown; readonly contactId: unknown; readonly contactPointId: unknown },
) {
  return repository.readContactSummary(live(scope), uuid(input.connectionId, 'connectionId'),
    uuid(input.contactId, 'contactId'), uuid(input.contactPointId, 'contactPointId'));
}

export async function recordTextingConsentCommand(
  repository: TwilioOperationRepository,
  scope: WorkspaceScope,
  input: {
    readonly connectionId: unknown; readonly contactId: unknown; readonly contactPointId: unknown;
    readonly useCase: unknown; readonly status: unknown; readonly collectionMethod: unknown;
    readonly disclosureVersion: unknown; readonly evidenceReference: unknown;
    readonly recipientTimeZone?: unknown; readonly timezoneSource?: unknown;
  },
  now = new Date(),
) {
  const status = String(input.status) as TextingConsentStatus;
  if (!['unknown', 'opted_in', 'opted_out'].includes(status)) {
    throw new ConnectorError('invalid-input', 'Texting consent status is invalid.');
  }
  return repository.recordConsent(live(scope), {
    connectionId: uuid(input.connectionId, 'connectionId'), contactId: uuid(input.contactId, 'contactId'),
    contactPointId: uuid(input.contactPointId, 'contactPointId'), useCase: parseTextingUseCase(input.useCase), status,
    collectionMethod: required(input.collectionMethod, 'collectionMethod', 64),
    disclosureVersion: required(input.disclosureVersion, 'disclosureVersion', 80),
    evidenceHash: sha256Hex(required(input.evidenceReference, 'evidenceReference', 1_024)),
    ...(input.recipientTimeZone ? { recipientTimeZone: verifiedTimeZone(input.recipientTimeZone) } : {}),
    ...(input.timezoneSource ? { timezoneSource: required(input.timezoneSource, 'timezoneSource', 64) } : {}),
    correlationId: randomUUID(), occurredAt: now.toISOString(),
  });
}

export async function prepareTextingMessageCommand(
  repository: TwilioOperationRepository,
  scope: WorkspaceScope,
  input: {
    readonly connectionId: unknown; readonly contactId: unknown; readonly contactPointId: unknown;
    readonly recipientPhone: unknown; readonly useCase: unknown; readonly body: unknown;
  },
  outboundGuard: ContactOutboundGuard,
  now = new Date(),
) {
  const useCase = parseTextingUseCase(input.useCase);
  const body = parseTextMessageBody(input.body);
  const liveScope = live(scope);
  const contactId = uuid(input.contactId, 'contactId');
  const contactPointId = uuid(input.contactPointId, 'contactPointId');
  const reviewedTarget = await outboundGuard.assertTarget(liveScope, contactId, contactPointId);
  return repository.createDraftAndIntent(liveScope, {
    connectionId: uuid(input.connectionId, 'connectionId'), draftId: randomUUID(),
    contactId, contactPointId, reviewedAliasEpoch: reviewedTarget.aliasEpoch,
    recipientPhone: parseE164Phone(input.recipientPhone), useCase, body,
    summary: `Send one consented ${useCase} text.`, correlationId: randomUUID(), occurredAt: now.toISOString(),
  });
}

export async function approveTextingIntentCommand(
  repository: TwilioOperationRepository,
  scopeInput: WorkspaceScope,
  input: { readonly intentId: unknown; readonly intentVersion: unknown; readonly payloadHash: unknown },
  now = new Date(),
) {
  const scope = live(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Only the workspace owner can approve provider texting.');
  const version = Number(input.intentVersion);
  const payloadHash = required(input.payloadHash, 'payloadHash', 64);
  if (!Number.isInteger(version) || version < 1 || !/^[0-9a-f]{64}$/.test(payloadHash)) {
    throw new ConnectorError('invalid-input', 'Texting intent version is invalid.');
  }
  return repository.approvePreparedIntent(scope, {
    intentId: uuid(input.intentId, 'intentId'), intentVersion: version, payloadHash,
    idempotencyKey: `twilio-send:${uuid(input.intentId, 'intentId')}:${version}`,
    correlationId: randomUUID(), evaluatedAt: now.toISOString(),
  });
}

export async function disableTextingCommand(
  repository: TwilioOperationRepository,
  scopeInput: WorkspaceScope,
  input: { readonly connectionId: unknown; readonly destroySendCredentials?: boolean },
  now = new Date(),
) {
  const scope = live(scopeInput);
  if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Only the workspace owner can disable provider texting.');
  return repository.disable(scope, {
    connectionId: uuid(input.connectionId, 'connectionId'),
    destroySendCredentials: input.destroySendCredentials === true,
    correlationId: randomUUID(), occurredAt: now.toISOString(),
  });
}
