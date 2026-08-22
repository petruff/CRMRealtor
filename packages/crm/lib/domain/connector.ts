import { createHash } from 'node:crypto';

export const CONNECTOR_PROVIDERS = [
  'contract-test',
  'google',
  'mailchimp',
  'twilio',
  'meta',
] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const CONNECTOR_CONNECTION_STATUSES = [
  'authorizing',
  'active',
  'degraded',
  'reauthorization-required',
  'revoking',
  'disconnected',
  'disconnected-unconfirmed',
] as const;
export type ConnectorConnectionStatus = (typeof CONNECTOR_CONNECTION_STATUSES)[number];

export const CONNECTOR_INTENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'editing',
  'queued',
  'executing',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type ConnectorIntentStatus = (typeof CONNECTOR_INTENT_STATUSES)[number];

export const CONNECTOR_JOB_STATES = [
  'queued',
  'leased',
  'executing',
  'retry-scheduled',
  'reconciliation-required',
  'succeeded',
  'failed',
  'dead-letter',
  'cancelled',
] as const;
export type ConnectorJobState = (typeof CONNECTOR_JOB_STATES)[number];

export const CONNECTOR_RECEIPT_TYPES = [
  'intent.created',
  'intent.edited',
  'intent.approved',
  'intent.rejected',
  'job.queued',
  'attempt.started',
  'provider.accepted',
  'provider.final',
  'provider.failed',
  'provider.unknown',
  'job.retry-scheduled',
  'job.reconciled',
  'job.failed',
  'reconciliation.started',
  'reconciliation.resolved',
  'webhook.accepted',
  'webhook.rejected',
  'revocation.requested',
  'revocation.completed',
  'connection.probed',
  'job.cancelled',
  'connection.tested',
  'connection.disconnected',
  'lease.expired',
  'job.retried',
  'oauth.started',
  'oauth.completed',
  'audience.selected',
  'audience.replaced',
  'sync.applied',
  'sync.reviewed',
  'oauth.token-refreshed',
  'gmail.send-linked',
] as const;
export type ConnectorReceiptType = (typeof CONNECTOR_RECEIPT_TYPES)[number];

export const CONNECTOR_ERROR_CATEGORIES = [
  'none',
  'configuration_required',
  'authorization_revoked',
  'permission_denied',
  'validation_failed',
  'consent_required',
  'compliance_blocked',
  'rate_limited',
  'provider_unavailable',
  'network_not_sent',
  'network_outcome_unknown',
  'provider_acceptance_unknown',
  'reconciliation_items_require_review',
  'internal_error',
] as const;
export type ConnectorErrorCategory = (typeof CONNECTOR_ERROR_CATEGORIES)[number];

export const CONNECTOR_ACTION_MAX = 96;
export const CONNECTOR_SUMMARY_MAX = 500;
export const CONNECTOR_IDEMPOTENCY_MAX = 128;
export const CONNECTOR_LIST_MAX = 500;
export const CONNECTOR_WORKER_BATCH_MAX = 25;

export interface ConnectorDefinition {
  readonly provider: ConnectorProvider;
  readonly label: string;
  readonly mode: 'contract-test' | 'provider-disabled' | 'uat' | 'live';
  readonly enabled: boolean;
  readonly capabilities: readonly string[];
  readonly productionRequirements: readonly string[];
}

export interface ConnectorConnection {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: ConnectorProvider;
  readonly remoteAccountId: string;
  readonly remoteAccountLabel?: string;
  readonly grantedScopes: readonly string[];
  readonly status: ConnectorConnectionStatus;
  readonly tokenExpiresAt?: string;
  readonly tokenUpdatedAt?: string;
  readonly connectedAt: string;
  readonly updatedAt: string;
  readonly disconnectedAt?: string;
}

export interface ConnectorActionIntent {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: ConnectorProvider;
  readonly connectionId?: string;
  readonly actionType: string;
  readonly version: number;
  readonly payloadReference: string;
  readonly payloadHash: string;
  readonly summary: string;
  readonly status: ConnectorIntentStatus;
  readonly requestedByMembershipId: string;
  readonly approvedByMembershipId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt?: string;
  readonly rejectedAt?: string;
}

export interface ConnectorJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly intentId: string;
  readonly intentVersion: number;
  readonly provider: ConnectorProvider;
  readonly actionType: string;
  readonly payloadReference: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly state: ConnectorJobState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly scheduledAt: string;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: string;
  readonly fencingToken: number;
  readonly nextRetryAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface ConnectorReceipt {
  readonly id: string;
  readonly workspaceId: string;
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

export type ConnectorAdapterResult =
  | {
      readonly outcome: 'succeeded';
      readonly providerReceiptId: string;
      readonly providerStatus: string;
    }
  | {
      readonly outcome: 'retryable-failure';
      readonly errorCategory: 'provider_unavailable' | 'rate_limited' | 'network_not_sent';
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly outcome: 'unknown';
      readonly errorCategory: 'network_outcome_unknown' | 'provider_acceptance_unknown';
      readonly providerReceiptId?: string;
    }
  | {
      readonly outcome: 'terminal-failure';
      readonly errorCategory: Exclude<ConnectorErrorCategory,
        | 'none'
        | 'provider_unavailable'
        | 'rate_limited'
        | 'network_not_sent'
        | 'network_outcome_unknown'
        | 'provider_acceptance_unknown'>;
    };

export interface ConnectorAdapter {
  readonly provider: ConnectorProvider;
  execute(job: ConnectorJob): Promise<ConnectorAdapterResult>;
  reconcile(job: ConnectorJob): Promise<ConnectorAdapterResult>;
  testConnection?(connection: ConnectorConnection): Promise<ConnectorAdapterResult>;
  /** Provider-side grant revocation. Absence means no implemented revocation endpoint. */
  revoke?(connection: ConnectorConnection, accessToken?: string): Promise<ConnectorAdapterResult>;
}

export const CONNECTOR_ERROR_CODES = [
  'invalid-input',
  'forbidden',
  'not-found',
  'conflict',
  'configuration-required',
  'lease-lost',
  'provider-disabled',
  'provider-retryable',
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(code: ConnectorErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
  }
}

function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', `${field} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

export function parseConnectorIdentifier(value: unknown, field: string): string {
  const clean = cleanText(value, field, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(clean)) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

export function parseConnectorProvider(value: unknown): ConnectorProvider {
  if (!CONNECTOR_PROVIDERS.includes(value as ConnectorProvider)) {
    throw new ConnectorError('invalid-input', 'Connector provider is invalid.');
  }
  return value as ConnectorProvider;
}

export function parseConnectorAction(value: unknown): string {
  const clean = cleanText(value, 'actionType', CONNECTOR_ACTION_MAX);
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(clean)) {
    throw new ConnectorError('invalid-input', 'actionType is invalid.');
  }
  return clean;
}

export function parseConnectorSummary(value: unknown): string {
  return cleanText(value, 'summary', CONNECTOR_SUMMARY_MAX);
}

export function parseConnectorIdempotencyKey(value: unknown): string {
  const clean = cleanText(value, 'idempotencyKey', CONNECTOR_IDEMPOTENCY_MAX);
  if (!/^[A-Za-z0-9._:-]+$/.test(clean)) {
    throw new ConnectorError('invalid-input', 'idempotencyKey is invalid.');
  }
  return clean;
}

export function parseConnectorInstant(value: unknown, field: string): string {
  const clean = cleanText(value, field, 64);
  const date = new Date(clean);
  if (!Number.isFinite(date.getTime())) throw new ConnectorError('invalid-input', `${field} is invalid.`);
  return date.toISOString();
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stablePayloadHash(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    return input;
  };
  return sha256Hex(JSON.stringify(normalize(value)));
}

export function redactConnectorDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(?:token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .trim();
  return clean ? clean.slice(0, 500) : undefined;
}
