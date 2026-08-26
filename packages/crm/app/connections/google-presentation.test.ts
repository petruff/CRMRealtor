import { describe, expect, it } from 'vitest';
import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';
import {
  googleConnectionPresentation,
  googleSyncStateLabel,
  googleSyncStreamLabel,
} from './google-presentation';

function lifecycle(state: ConnectorLifecycleProjection['state'], safeSummary: string): ConnectorLifecycleProjection {
  return {
    provider: 'google', connectionId: 'connection-google', state, grantedScopes: [], missingScopes: [],
    baseline: 'not-applicable', webhook: 'not-applicable', providerEvidence: 'current',
    ownerAction: 'none', safeSummary, observedAt: '2026-08-25T12:00:00.000Z',
  };
}

describe('Google connection presentation', () => {
  it('uses only the canonical lifecycle meaning and calm summary', () => {
    expect(googleConnectionPresentation(lifecycle(
      'owner-consent-pending', 'Finish connecting this account to continue.',
    ))).toEqual({
      consentPending: true,
      description: 'Finish connecting this account to continue.',
    });
  });

  it('does not infer consent from raw scopes', () => {
    expect(googleConnectionPresentation(lifecycle('degraded', 'Try again shortly.'))).toEqual({
      consentPending: false,
      description: 'Try again shortly.',
    });
  });

  it('keeps sync diagnostics out of ordinary user copy', () => {
    expect(googleSyncStreamLabel('gmail-history')).toBe('Gmail activity');
    expect(googleSyncStateLabel('full_resync_required')).toBe('Needs attention');
    expect(googleSyncStateLabel('degraded')).toBe('Needs attention');
  });
});
