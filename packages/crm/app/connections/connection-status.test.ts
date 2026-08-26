import { describe, expect, it } from 'vitest';
import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';
import {
  canShowConnectorOwnerControls,
  canRecoverMailchimpLifecycle,
  canDisconnectLifecycle,
  canShowGoogleOperations,
  canShowMailchimpManagement,
  connectionCardStatus,
  connectionViewerMessage,
  otherConnectionCardStatus,
  SETUP_UNAVAILABLE_LABEL,
} from './connection-status';

function lifecycle(state: ConnectorLifecycleProjection['state']): ConnectorLifecycleProjection {
  return {
    provider: 'google', connectionId: 'connection-1', state, grantedScopes: [], missingScopes: [],
    baseline: 'not-applicable', webhook: 'not-applicable', providerEvidence: 'current',
    ownerAction: 'none', safeSummary: 'Safe summary', observedAt: '2026-08-25T12:00:00.000Z',
  };
}

describe('connection card status', () => {
  it.each([
    ['ready', 'ready', 'Connected · ready'],
    ['disconnected', 'ready', 'Ready to connect'],
    ['scope-pending', 'connected', 'Permission needed'],
    ['review-required', 'review', 'Review needed'],
    ['degraded', 'review', 'Needs attention'],
    ['not-configured', 'gated', SETUP_UNAVAILABLE_LABEL],
  ] as const)('maps canonical %s consistently', (state, status, label) => {
    expect(connectionCardStatus(lifecycle(state))).toEqual({ status, label });
  });

  it('keeps non-lifecycle Meta compatibility fail-closed', () => {
    expect(otherConnectionCardStatus({
      providerEnabled: false, connected: false, productionApproved: false,
    })).toEqual({ status: 'gated', label: SETUP_UNAVAILABLE_LABEL });
  });

  it('hides owner controls from a support administrator even if a legacy role is elevated', () => {
    expect(canShowConnectorOwnerControls({
      authenticatedUserId: 'support-user', ownerUserId: 'owner-user', membershipId: 'support-membership',
      workspaceId: 'workspace-1', role: 'owner', mode: 'live',
      supportGrant: { active: true },
    })).toBe(false);
    expect(canShowConnectorOwnerControls({
      authenticatedUserId: 'owner-user', ownerUserId: 'owner-user', membershipId: 'owner-membership',
      workspaceId: 'workspace-1', role: 'owner', mode: 'live',
    })).toBe(true);
  });

  it('describes support-admin access as safe viewing, never owner management', () => {
    const message = connectionViewerMessage({
      authenticatedUserId: 'support-user', ownerUserId: 'owner-user', membershipId: 'support-membership',
      workspaceId: 'workspace-1', role: 'assistant', mode: 'live', supportGrant: { active: true },
    }, 'Google Workspace');
    expect(message).toBe('Support administrators can view Google Workspace status. Only the workspace owner can change or disconnect this connection.');
    expect(message).not.toMatch(/assistant|manage this connection/i);
  });

  it('keeps management disabled for degraded truth without broadening Google disconnect', () => {
    expect(canShowGoogleOperations(lifecycle('degraded'))).toBe(false);
    expect(canShowMailchimpManagement({ ...lifecycle('degraded'), provider: 'mailchimp' })).toBe(false);
    expect(canDisconnectLifecycle(lifecycle('degraded'))).toBe(false);
    expect(canShowGoogleOperations(lifecycle('ready'))).toBe(true);
    expect(canDisconnectLifecycle(lifecycle('ready'))).toBe(true);
  });

  it('offers owner recovery for persisted degraded Mailchimp without enabling management', () => {
    const degraded = { ...lifecycle('degraded'), provider: 'mailchimp' as const };
    const disconnected = { ...lifecycle('disconnected'), provider: 'mailchimp' as const };
    expect(canRecoverMailchimpLifecycle(degraded)).toBe(true);
    expect(canDisconnectLifecycle(degraded)).toBe(true);
    expect(canShowMailchimpManagement(degraded)).toBe(false);
    expect(canRecoverMailchimpLifecycle(disconnected)).toBe(false);
  });
});
