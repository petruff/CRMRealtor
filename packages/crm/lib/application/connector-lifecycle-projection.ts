import { ConnectorError, type ConnectorConnection, type ConnectorDefinition } from '../domain/connector.ts';
import {
  reduceConnectorLifecycle,
  type ConnectorLifecycleAssessment,
  type ConnectorLifecycleProjection,
  type LifecycleRequirement,
} from '../domain/connector-lifecycle.ts';
import type { GoogleCapabilityState } from '../data/google-operation-repository.ts';
import type { MailchimpAudienceBinding } from '../domain/mailchimp.ts';
import type { MailchimpReconciliationRun } from '../data/supabase-mailchimp-reconciliation-repository.ts';
import type { MailchimpOutboundBackfillRun } from '../data/mailchimp-outbound-backfill-repository.ts';

export const GOOGLE_LIFECYCLE_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/calendar.app.created',
] as const;

export const CONNECTOR_LIFECYCLE_READ_TIMEOUT_MS = 2_500;
export const GOOGLE_LIFECYCLE_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1_000;

type ReadResult<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'failed'; readonly error: unknown };

export interface ConnectorLifecycleReadFailure {
  readonly operation: 'authorization' | 'owner-binding' | 'binding' | 'reconciliation'
    | 'backfill' | 'audiences' | 'capabilities';
  readonly error: unknown;
}

export interface MailchimpLifecycleReadResult {
  readonly projection: ConnectorLifecycleProjection;
  readonly binding?: MailchimpAudienceBinding;
  readonly reconciliation?: MailchimpReconciliationRun;
  readonly backfills: readonly MailchimpOutboundBackfillRun[];
  readonly audiences?: readonly { readonly id: string; readonly name: string; readonly memberCount?: number }[];
  readonly failures: readonly ConnectorLifecycleReadFailure[];
}

export interface GoogleLifecycleReadResult {
  readonly projection: ConnectorLifecycleProjection;
  readonly capabilityState?: GoogleCapabilityState;
  readonly failures: readonly ConnectorLifecycleReadFailure[];
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function boundedRead<T>(reader: () => Promise<T>, timeoutMs: number): Promise<ReadResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader().then((value) => ({ status: 'fulfilled' as const, value }))
        .catch((error: unknown) => ({ status: 'failed' as const, error })),
      new Promise<ReadResult<T>>((resolve) => {
        timeout = setTimeout(() => resolve({
          status: 'failed',
          error: new Error('Connector lifecycle read timed out.'),
        }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function baseAssessment(
  provider: 'google' | 'mailchimp',
  definition: ConnectorDefinition | undefined,
  connection: ConnectorConnection | undefined,
  observedAt: string,
): Pick<ConnectorLifecycleAssessment,
  'provider' | 'configured' | 'connectionId' | 'connectionStatus' | 'grantedScopes'
  | 'authorization' | 'observedAt'> {
  const authorization: LifecycleRequirement = !connection
    ? 'unknown'
    : connection.status === 'authorizing'
      ? 'pending'
      : connection.status === 'reauthorization-required'
        ? 'failed'
        : ['active', 'degraded'].includes(connection.status)
          ? 'satisfied'
          : 'unknown';
  return {
    provider,
    configured: definition?.enabled === true,
    ...(connection ? {
      connectionId: connection.id,
      connectionStatus: connection.status,
      grantedScopes: connection.grantedScopes,
    } : {}),
    authorization,
    observedAt,
  };
}

function emptyProviderAssessment(
  provider: 'google' | 'mailchimp',
  definition: ConnectorDefinition | undefined,
  connection: ConnectorConnection | undefined,
  observedAt: string,
): ConnectorLifecycleAssessment {
  return {
    ...baseAssessment(provider, definition, connection, observedAt),
    ownerAuthorization: connection ? 'satisfied' : 'unknown',
    refreshAuthority: 'not-applicable',
    capabilityReads: 'not-applicable',
    webhook: 'not-applicable',
    baseline: 'not-applicable',
    reconciliation: 'not-applicable',
    backfill: 'not-applicable',
    providerEvidence: 'current',
  };
}

function latestBackfillState(backfills: readonly MailchimpOutboundBackfillRun[]): LifecycleRequirement {
  if (backfills.some((run) => run.state === 'review')) return 'review';
  if (backfills.some((run) => ['retry_wait', 'cancelled'].includes(run.state))) return 'failed';
  if (backfills.some((run) => ['previewed', 'approved', 'leased', 'executing'].includes(run.state))) {
    return 'running';
  }
  return 'satisfied';
}

function reconciliationState(run: MailchimpReconciliationRun | undefined): LifecycleRequirement {
  if (!run) return 'satisfied';
  if (run.state === 'review' || run.itemsBlocked > 0 || run.itemsReviewed > 0) return 'review';
  if (['queued', 'leased', 'executing'].includes(run.state)) return 'running';
  if (['retry_wait', 'cancelled'].includes(run.state)) return 'failed';
  return run.state === 'succeeded' ? 'satisfied' : 'unknown';
}

function baselineState(
  binding: MailchimpAudienceBinding | undefined,
  reconciliation: MailchimpReconciliationRun | undefined,
): LifecycleRequirement {
  if (!binding) return 'pending';
  if (!binding.baselineRequired) return 'satisfied';
  if (!reconciliation || reconciliation.mode !== 'baseline') return 'pending';
  if (['queued', 'leased', 'executing'].includes(reconciliation.state)) return 'running';
  if (reconciliation.state === 'review') return 'review';
  return reconciliation.state === 'succeeded' ? 'satisfied' : 'failed';
}

function readFailures<T>(
  operation: ConnectorLifecycleReadFailure['operation'],
  result: ReadResult<T>,
): ConnectorLifecycleReadFailure[] {
  return result.status === 'failed' ? [{ operation, error: result.error }] : [];
}

function requiresReauthorization(result: ReadResult<unknown> | undefined): boolean {
  return result?.status === 'failed'
    && result.error instanceof ConnectorError
    && result.error.code === 'forbidden';
}

export async function readMailchimpLifecycle(input: {
  readonly definition?: ConnectorDefinition;
  readonly connection?: ConnectorConnection;
  readonly observedAt?: Date;
  readonly timeoutMs?: number;
  readonly readAuthorization?: () => Promise<boolean>;
  /** Reads persisted evidence that the connection belongs to the canonical owner. */
  readonly readOwnerAuthorization?: () => Promise<boolean>;
  readonly readBinding?: () => Promise<MailchimpAudienceBinding | undefined>;
  readonly readReconciliation?: () => Promise<readonly MailchimpReconciliationRun[]>;
  readonly readBackfills?: () => Promise<readonly MailchimpOutboundBackfillRun[]>;
  readonly readAudiences?: () => Promise<readonly { readonly id: string; readonly name: string; readonly memberCount?: number }[]>;
}): Promise<MailchimpLifecycleReadResult> {
  const observedAt = (input.observedAt ?? new Date()).toISOString();
  if (!input.connection) {
    return {
      projection: reduceConnectorLifecycle(emptyProviderAssessment(
        'mailchimp', input.definition, undefined, observedAt,
      )),
      backfills: [],
      failures: [],
    };
  }
  const timeoutMs = input.timeoutMs ?? CONNECTOR_LIFECYCLE_READ_TIMEOUT_MS;
  const [authorization, ownerAuthorization, binding, reconciliation, backfills, audiences] = await Promise.all([
    boundedRead(input.readAuthorization ?? (() => Promise.reject(new Error('Mailchimp authorization reader is unavailable.'))), timeoutMs),
    boundedRead(input.readOwnerAuthorization ?? (() => Promise.reject(new Error('Canonical-owner binding reader is unavailable.'))), timeoutMs),
    boundedRead(input.readBinding ?? (() => Promise.reject(new Error('Audience binding reader is unavailable.'))), timeoutMs),
    boundedRead(input.readReconciliation ?? (() => Promise.reject(new Error('Reconciliation reader is unavailable.'))), timeoutMs),
    boundedRead(input.readBackfills ?? (() => Promise.reject(new Error('Backfill reader is unavailable.'))), timeoutMs),
    input.readAudiences ? boundedRead(input.readAudiences, timeoutMs) : undefined,
  ]);
  const selected = binding.status === 'fulfilled' ? binding.value : undefined;
  const latestReconciliation = reconciliation.status === 'fulfilled' ? reconciliation.value[0] : undefined;
  const backfillRuns = backfills.status === 'fulfilled' ? backfills.value : [];
  const requiredFailures = [
    ...readFailures('authorization', authorization),
    ...readFailures('owner-binding', ownerAuthorization),
    ...readFailures('binding', binding),
    ...readFailures('reconciliation', reconciliation),
    ...readFailures('backfill', backfills),
  ];
  const failures = [...requiredFailures, ...(audiences ? readFailures('audiences', audiences) : [])];
  const audienceAuthorizationRejected = requiresReauthorization(audiences);
  const assessment: ConnectorLifecycleAssessment = {
    ...baseAssessment('mailchimp', input.definition, input.connection, observedAt),
    authorization: audienceAuthorizationRejected
      ? 'failed'
      : authorization.status === 'fulfilled'
      ? authorization.value ? 'satisfied' : 'failed'
      : 'unknown',
    ownerAuthorization: ownerAuthorization.status === 'fulfilled'
      ? ownerAuthorization.value ? 'satisfied' : 'failed'
      : 'unknown',
    refreshAuthority: 'not-applicable',
    capabilityReads: 'not-applicable',
    webhook: selected
      ? selected.webhookRegistrationRequired ? 'pending' : 'satisfied'
      : binding.status === 'failed' ? 'unknown' : 'pending',
    baseline: binding.status === 'failed' ? 'unknown' : baselineState(selected, latestReconciliation),
    reconciliation: reconciliation.status === 'failed' ? 'unknown' : reconciliationState(latestReconciliation),
    backfill: backfills.status === 'failed' ? 'unknown' : latestBackfillState(backfillRuns),
    providerEvidence: requiredFailures.length ? 'missing' : 'current',
    requiredReadFailed: requiredFailures.length > 0,
    observedAt,
  };
  return {
    projection: reduceConnectorLifecycle(assessment),
    ...(selected ? { binding: selected } : {}),
    ...(latestReconciliation ? { reconciliation: latestReconciliation } : {}),
    backfills: backfillRuns,
    ...(audiences?.status === 'fulfilled' ? { audiences: audiences.value } : {}),
    failures,
  };
}

export async function readGoogleLifecycle(input: {
  readonly definition?: ConnectorDefinition;
  readonly connection?: ConnectorConnection;
  readonly observedAt?: Date;
  readonly timeoutMs?: number;
  readonly evidenceMaxAgeMs?: number;
  /** Reads persisted evidence that the completed OAuth binding belongs to the canonical owner. */
  readonly readOwnerAuthorization?: () => Promise<boolean>;
  readonly readCapabilities?: () => Promise<GoogleCapabilityState>;
}): Promise<GoogleLifecycleReadResult> {
  const now = input.observedAt ?? new Date();
  const observedAt = now.toISOString();
  if (!input.connection) {
    return {
      projection: reduceConnectorLifecycle({
        ...emptyProviderAssessment('google', input.definition, undefined, observedAt),
        requiredScopes: GOOGLE_LIFECYCLE_REQUIRED_SCOPES,
      }),
      failures: [],
    };
  }
  const timeoutMs = input.timeoutMs ?? CONNECTOR_LIFECYCLE_READ_TIMEOUT_MS;
  const [result, ownerAuthorization] = await Promise.all([
    boundedRead(
      input.readCapabilities ?? (() => Promise.reject(new Error('Google capability reader is unavailable.'))),
      timeoutMs,
    ),
    boundedRead(
      input.readOwnerAuthorization ?? (() => Promise.reject(new Error('Canonical-owner binding reader is unavailable.'))),
      timeoutMs,
    ),
  ]);
  const capabilityState = result.status === 'fulfilled' ? result.value : undefined;
  const probeAt = timestamp(capabilityState?.connection.lastProbeAt);
  const evidenceAge = probeAt === undefined ? undefined : now.getTime() - probeAt;
  const providerEvidence = result.status === 'failed' || probeAt === undefined
    ? 'missing'
    : evidenceAge! < 0 || evidenceAge! > (input.evidenceMaxAgeMs ?? GOOGLE_LIFECYCLE_EVIDENCE_MAX_AGE_MS)
      ? 'stale'
      : 'current';
  const relevantCapabilities = capabilityState?.capabilities
    .filter((capability) => capability.requiredScopes.some((scope) => GOOGLE_LIFECYCLE_REQUIRED_SCOPES.includes(
      scope as (typeof GOOGLE_LIFECYCLE_REQUIRED_SCOPES)[number],
    ))) ?? [];
  const coveredScopes = new Set(relevantCapabilities.flatMap((capability) => capability.requiredScopes));
  const requiredBundlesHealthy = relevantCapabilities.length > 0
    && GOOGLE_LIFECYCLE_REQUIRED_SCOPES.every((scope) => coveredScopes.has(scope))
    && relevantCapabilities.every((capability) => capability.state === 'active');
  const syncHealthy = capabilityState?.sync.every((stream) => ![
    'degraded', 'full_resync_required',
  ].includes(stream.state)) === true;
  const ownerAuthorityMatches = capabilityState
    ? capabilityState.connection.id === input.connection.id
      && capabilityState.connection.workspaceId === input.connection.workspaceId
    : false;
  const grantedScopes = capabilityState?.connection.grantedScopes ?? input.connection.grantedScopes;
  const failures = [
    ...readFailures('capabilities', result),
    ...readFailures('owner-binding', ownerAuthorization),
  ];
  const assessment: ConnectorLifecycleAssessment = {
    ...baseAssessment('google', input.definition, input.connection, observedAt),
    grantedScopes,
    requiredScopes: GOOGLE_LIFECYCLE_REQUIRED_SCOPES,
    ownerAuthorization: capabilityState && ownerAuthorization.status === 'fulfilled'
      ? ownerAuthorityMatches && ownerAuthorization.value ? 'satisfied' : 'failed'
      : 'unknown',
    refreshAuthority: capabilityState
      ? capabilityState.tokenState.refreshPresent ? 'satisfied' : 'failed'
      : 'unknown',
    capabilityReads: capabilityState
      ? requiredBundlesHealthy && syncHealthy ? 'satisfied' : 'failed'
      : 'unknown',
    webhook: 'not-applicable',
    baseline: 'not-applicable',
    reconciliation: 'not-applicable',
    backfill: 'not-applicable',
    providerEvidence,
    requiredReadFailed: failures.length > 0,
    contradictory: capabilityState
      ? capabilityState.connection.status !== input.connection.status
        || capabilityState.connection.grantedScopes.some((scope) => !input.connection?.grantedScopes.includes(scope))
      : false,
    observedAt,
  };
  return {
    projection: reduceConnectorLifecycle(assessment),
    ...(capabilityState ? { capabilityState } : {}),
    failures,
  };
}
