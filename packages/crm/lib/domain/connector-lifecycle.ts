import type { ConnectorProvider } from './connector.ts';

export const CONNECTOR_LIFECYCLE_STATES = [
  'not-configured',
  'disconnected',
  'disconnect-pending',
  'owner-consent-pending',
  'reconnect-required',
  'scope-pending',
  'webhook-pending',
  'baseline-pending',
  'baseline-running',
  'review-required',
  'degraded',
  'ready',
] as const;

export type ConnectorLifecycleState = (typeof CONNECTOR_LIFECYCLE_STATES)[number];
export type LifecycleProvider = Extract<ConnectorProvider, 'google' | 'mailchimp'>;
export type LifecycleRequirement =
  | 'satisfied'
  | 'pending'
  | 'running'
  | 'review'
  | 'failed'
  | 'unknown'
  | 'not-applicable';

export interface ConnectorLifecycleProjection {
  readonly provider: LifecycleProvider;
  readonly connectionId?: string;
  readonly state: ConnectorLifecycleState;
  readonly grantedScopes: readonly string[];
  readonly missingScopes: readonly string[];
  readonly baseline: 'not-applicable' | 'pending' | 'running' | 'review' | 'complete' | 'unknown';
  readonly webhook: 'not-applicable' | 'pending' | 'active' | 'unknown';
  readonly providerEvidence: 'missing' | 'stale' | 'current';
  readonly ownerAction: 'none' | 'connect' | 'finish-consent' | 'reconnect' | 'review';
  readonly safeSummary: string;
  readonly observedAt: string;
}

export interface ConnectorLifecycleAssessment {
  readonly provider: LifecycleProvider;
  readonly connectionId?: string;
  readonly connectionStatus?: string;
  readonly configured: boolean;
  readonly grantedScopes?: readonly string[];
  readonly requiredScopes?: readonly string[];
  readonly authorization: LifecycleRequirement;
  readonly ownerAuthorization: LifecycleRequirement;
  readonly refreshAuthority: LifecycleRequirement;
  readonly capabilityReads: LifecycleRequirement;
  readonly webhook: LifecycleRequirement;
  readonly baseline: LifecycleRequirement;
  readonly reconciliation: LifecycleRequirement;
  readonly backfill: LifecycleRequirement;
  readonly providerEvidence: 'missing' | 'stale' | 'current';
  readonly requiredReadFailed?: boolean;
  readonly contradictory?: boolean;
  readonly observedAt: string;
}

const SUMMARY: Record<ConnectorLifecycleState, string> = {
  'not-configured': 'This connection is not available yet.',
  disconnected: 'This service is ready to connect.',
  'disconnect-pending': 'The account is disconnecting. This page will update when it finishes.',
  'owner-consent-pending': 'Finish connecting this account to continue.',
  'reconnect-required': 'Reconnect this account to restore updates.',
  'scope-pending': 'A permission still needs approval.',
  'webhook-pending': 'Finish setup so subscription changes stay up to date.',
  'baseline-pending': 'Choose what to sync, then start the first update.',
  'baseline-running': 'The first update is still in progress.',
  'review-required': 'A few items need review before updates can continue.',
  degraded: 'Omnix could not confirm this connection. Try again shortly.',
  ready: 'Connected and ready.',
};

const OWNER_ACTION: Record<ConnectorLifecycleState, ConnectorLifecycleProjection['ownerAction']> = {
  'not-configured': 'none',
  disconnected: 'connect',
  'disconnect-pending': 'none',
  'owner-consent-pending': 'finish-consent',
  'reconnect-required': 'reconnect',
  'scope-pending': 'finish-consent',
  'webhook-pending': 'review',
  'baseline-pending': 'review',
  'baseline-running': 'none',
  'review-required': 'review',
  degraded: 'review',
  ready: 'none',
};

function baselineState(value: LifecycleRequirement): ConnectorLifecycleProjection['baseline'] {
  if (value === 'not-applicable') return 'not-applicable';
  if (value === 'satisfied') return 'complete';
  if (value === 'pending') return 'pending';
  if (value === 'running') return 'running';
  if (value === 'review') return 'review';
  return 'unknown';
}

function webhookState(value: LifecycleRequirement): ConnectorLifecycleProjection['webhook'] {
  if (value === 'not-applicable') return 'not-applicable';
  if (value === 'satisfied') return 'active';
  if (value === 'pending') return 'pending';
  return 'unknown';
}

function missingScopes(input: ConnectorLifecycleAssessment): string[] {
  const granted = new Set(input.grantedScopes ?? []);
  return [...new Set(input.requiredScopes ?? [])].filter((scope) => !granted.has(scope));
}

function degraded(input: ConnectorLifecycleAssessment): boolean {
  const required = [
    input.authorization,
    input.ownerAuthorization,
    input.refreshAuthority,
    input.capabilityReads,
    input.webhook,
    input.baseline,
    input.reconciliation,
    input.backfill,
  ];
  return input.requiredReadFailed === true
    || input.contradictory === true
    || input.providerEvidence !== 'current'
    || required.some((value) => value === 'failed' || value === 'unknown');
}

function lifecycleState(input: ConnectorLifecycleAssessment, scopeMissing: readonly string[]): ConnectorLifecycleState {
  if (input.connectionStatus === 'disconnected') return 'disconnected';
  if (['revoking', 'disconnected-unconfirmed'].includes(input.connectionStatus ?? '')) {
    return 'disconnect-pending';
  }
  if (!input.configured) return 'not-configured';
  if (!input.connectionId) return 'disconnected';
  if (input.connectionStatus === 'reauthorization-required' || input.authorization === 'failed') {
    return 'reconnect-required';
  }
  if (input.connectionStatus === 'authorizing' || input.authorization === 'pending'
    || input.ownerAuthorization === 'pending') {
    return 'owner-consent-pending';
  }
  if (scopeMissing.length > 0) return 'scope-pending';
  if (input.requiredReadFailed === true) return 'degraded';
  if (input.webhook === 'pending') return 'webhook-pending';
  if (input.baseline === 'pending') return 'baseline-pending';
  if (input.baseline === 'running' || input.reconciliation === 'running' || input.backfill === 'running') {
    return 'baseline-running';
  }
  if (input.baseline === 'review' || input.reconciliation === 'review' || input.backfill === 'review') {
    return 'review-required';
  }
  if (degraded(input) || input.connectionStatus !== 'active') return 'degraded';
  return 'ready';
}

/** Pure, fail-closed precedence reducer for every connector read surface. */
export function reduceConnectorLifecycle(
  input: ConnectorLifecycleAssessment,
): ConnectorLifecycleProjection {
  const missing = missingScopes(input);
  const state = lifecycleState(input, missing);
  return Object.freeze({
    provider: input.provider,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    state,
    grantedScopes: Object.freeze([...new Set(input.grantedScopes ?? [])]),
    missingScopes: Object.freeze(missing),
    baseline: baselineState(input.baseline),
    webhook: webhookState(input.webhook),
    providerEvidence: input.providerEvidence,
    ownerAction: OWNER_ACTION[state],
    safeSummary: SUMMARY[state],
    observedAt: new Date(input.observedAt).toISOString(),
  });
}
