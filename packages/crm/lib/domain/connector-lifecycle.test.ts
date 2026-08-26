import { describe, expect, it } from 'vitest';
import {
  reduceConnectorLifecycle,
  type ConnectorLifecycleAssessment,
  type ConnectorLifecycleState,
} from './connector-lifecycle.ts';

const NOW = '2026-08-25T12:00:00.000Z';

function readyGoogle(
  overrides: Partial<ConnectorLifecycleAssessment> = {},
): ConnectorLifecycleAssessment {
  return {
    provider: 'google',
    configured: true,
    connectionId: 'connection-google',
    connectionStatus: 'active',
    grantedScopes: ['gmail.send', 'gmail.metadata', 'calendar'],
    requiredScopes: ['gmail.send', 'gmail.metadata', 'calendar'],
    authorization: 'satisfied',
    ownerAuthorization: 'satisfied',
    refreshAuthority: 'satisfied',
    capabilityReads: 'satisfied',
    webhook: 'not-applicable',
    baseline: 'not-applicable',
    reconciliation: 'not-applicable',
    backfill: 'not-applicable',
    providerEvidence: 'current',
    observedAt: NOW,
    ...overrides,
  };
}

describe('connector lifecycle precedence reducer', () => {
  it.each<[string, Partial<ConnectorLifecycleAssessment>, ConnectorLifecycleState]>([
    ['disconnected', { connectionStatus: 'disconnected' }, 'disconnected'],
    ['revoking', { connectionStatus: 'revoking' }, 'disconnect-pending'],
    ['missing configuration', { configured: false }, 'not-configured'],
    ['revoked authorization', { authorization: 'failed' }, 'reconnect-required'],
    ['owner consent', { authorization: 'pending' }, 'owner-consent-pending'],
    ['partial exact scopes', { grantedScopes: ['gmail.send'] }, 'scope-pending'],
    ['signed webhook pending', { webhook: 'pending' }, 'webhook-pending'],
    ['baseline pending', { baseline: 'pending' }, 'baseline-pending'],
    ['baseline running', { baseline: 'running' }, 'baseline-running'],
    ['reconciliation review', { reconciliation: 'review' }, 'review-required'],
    ['backfill review', { backfill: 'review' }, 'review-required'],
    ['failed required read', { requiredReadFailed: true }, 'degraded'],
    ['stale evidence', { providerEvidence: 'stale' }, 'degraded'],
    ['contradictory facts', { contradictory: true }, 'degraded'],
    ['all affirmative and current', {}, 'ready'],
  ])('reduces %s to %s', (_label, overrides, expected) => {
    expect(reduceConnectorLifecycle(readyGoogle(overrides)).state).toBe(expected);
  });

  it('never promotes unknown evidence to ready', () => {
    const requirementKeys: Array<keyof ConnectorLifecycleAssessment> = [
      'authorization',
      'ownerAuthorization',
      'refreshAuthority',
      'capabilityReads',
      'webhook',
      'baseline',
      'reconciliation',
      'backfill',
    ];
    for (const key of requirementKeys) {
      const projection = reduceConnectorLifecycle(readyGoogle({ [key]: 'unknown' }));
      expect(projection.state, key).not.toBe('ready');
    }
  });

  it('returns calm summaries without provider diagnostics', () => {
    const projection = reduceConnectorLifecycle(readyGoogle({
      requiredReadFailed: true,
      providerEvidence: 'missing',
    }));
    expect(projection.safeSummary).toBe('Omnix could not confirm this connection. Try again shortly.');
    expect(projection.safeSummary).not.toMatch(/oauth|scope|capability|hash|uat|deployment/i);
  });
});
