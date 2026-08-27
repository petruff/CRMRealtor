import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';
import { isCanonicalWorkspaceOwnerScope, type WorkspaceScope } from '@/lib/domain/workspace';

export type ConnectionCardStatus = 'ready' | 'connected' | 'review' | 'uat' | 'building' | 'gated';
export const SETUP_UNAVAILABLE_LABEL = 'Setup unavailable';

export function connectionCardStatus(
  lifecycle: ConnectorLifecycleProjection,
): { readonly status: ConnectionCardStatus; readonly label: string } {
  switch (lifecycle.state) {
    case 'ready': return { status: 'ready', label: 'Connected · ready' };
    case 'disconnected': return { status: 'ready', label: 'Ready to connect' };
    case 'not-configured': return { status: 'gated', label: SETUP_UNAVAILABLE_LABEL };
    case 'disconnect-pending': return { status: 'connected', label: 'Disconnecting' };
    case 'owner-consent-pending': return { status: 'connected', label: 'Finish connection' };
    case 'scope-pending': return { status: 'connected', label: 'Permission needed' };
    case 'webhook-pending':
    case 'baseline-pending': return { status: 'connected', label: 'Finish setup' };
    case 'baseline-running': return { status: 'connected', label: 'Updating' };
    case 'reconnect-required': return { status: 'review', label: 'Reconnect needed' };
    case 'review-required': return { status: 'review', label: 'Review needed' };
    case 'degraded': return { status: 'review', label: 'Needs attention' };
  }
}

export function canShowConnectorOwnerControls(scope: WorkspaceScope): boolean {
  return isCanonicalWorkspaceOwnerScope(scope);
}

export function connectionViewerMessage(scope: WorkspaceScope, providerLabel: string): string {
  if (scope.supportGrant?.active === true) {
    return `Support administrators can view ${providerLabel} status. Only the workspace owner can change or disconnect this connection.`;
  }
  return `Assistants can view ${providerLabel} status. Only the workspace owner can change or disconnect this connection.`;
}

export function canShowGoogleOperations(lifecycle: ConnectorLifecycleProjection): boolean {
  return lifecycle.provider === 'google' && lifecycle.state === 'ready';
}

export function canShowMailchimpManagement(lifecycle: ConnectorLifecycleProjection): boolean {
  return lifecycle.provider === 'mailchimp' && [
    'ready', 'webhook-pending', 'baseline-pending', 'baseline-running', 'review-required',
  ].includes(lifecycle.state);
}

export function canDisconnectLifecycle(lifecycle: ConnectorLifecycleProjection): boolean {
  if (!lifecycle.connectionId) return false;
  if (lifecycle.state === 'degraded') return lifecycle.provider === 'mailchimp';
  return ![
    'not-configured', 'disconnected', 'disconnect-pending', 'owner-consent-pending',
  ]
    .includes(lifecycle.state);
}

export function canRecoverMailchimpLifecycle(lifecycle: ConnectorLifecycleProjection): boolean {
  return lifecycle.provider === 'mailchimp'
    && Boolean(lifecycle.connectionId)
    && ['degraded', 'reconnect-required'].includes(lifecycle.state);
}

export interface OtherConnectionStatusFacts {
  readonly providerEnabled: boolean;
  readonly connected: boolean;
  readonly productionApproved: boolean;
}

/** Meta/Twilio compatibility only; Google and Mailchimp use the canonical lifecycle. */
export function otherConnectionCardStatus(
  facts: OtherConnectionStatusFacts,
): { readonly status: ConnectionCardStatus; readonly label?: string } {
  if (!facts.providerEnabled) return { status: 'gated', label: SETUP_UNAVAILABLE_LABEL };
  if (!facts.connected) return { status: 'uat' };
  if (facts.productionApproved) return { status: 'ready', label: 'Connected · ready' };
  return { status: 'connected', label: 'Connected · final check pending' };
}
