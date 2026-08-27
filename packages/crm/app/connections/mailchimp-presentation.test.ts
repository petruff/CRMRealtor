import { describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@/lib/domain/connector';
import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';
import {
  classifyMailchimpAudienceLoadIssue,
  mailchimpConnectionNeedsAttention,
  mailchimpConnectionRequiresReauthorization,
  mailchimpConnectionSummaryLabel,
  mailchimpSetupNoticeCode,
  recordMailchimpReadFailure,
} from './mailchimp-presentation';

function lifecycle(
  state: ConnectorLifecycleProjection['state'],
  safeSummary: string,
): ConnectorLifecycleProjection {
  return {
    provider: 'mailchimp', connectionId: 'connection-mailchimp', state,
    grantedScopes: [], missingScopes: [], baseline: 'complete', webhook: 'active',
    providerEvidence: 'current', ownerAction: 'none', safeSummary,
    observedAt: '2026-08-25T12:00:00.000Z',
  };
}

describe('Mailchimp connection presentation', () => {
  it('asks for reconnection only when provider authorization is rejected', () => {
    expect(classifyMailchimpAudienceLoadIssue(new ConnectorError('forbidden', 'provider rejected token')).kind)
      .toBe('reconnect');
    expect(classifyMailchimpAudienceLoadIssue(new ConnectorError('provider-retryable', 'rate limited')).kind)
      .toBe('temporary');
    const unavailable = classifyMailchimpAudienceLoadIssue(new Error('database unavailable'));
    expect(unavailable.kind).toBe('developer');
    expect(`${unavailable.title} ${unavailable.message}`).not.toMatch(/developer|database|oauth|token/i);
  });

  it('never exposes the raw error or connection id in observability', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const connectionId = 'connection-secret-looking-id';
    recordMailchimpReadFailure({
      operation: 'audiences',
      connectionId,
      error: new ConnectorError('forbidden', 'token=should-never-appear'),
    });
    const serialized = String(spy.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(connectionId);
    expect(serialized).not.toContain('should-never-appear');
    expect(serialized).toContain('reconnect');
    spy.mockRestore();
  });

  it('uses the canonical lifecycle instead of raw connection or read-error inference', () => {
    const reconnect = lifecycle('reconnect-required', 'Reconnect this account to restore updates.');
    expect(mailchimpConnectionNeedsAttention(reconnect)).toBe(true);
    expect(mailchimpConnectionRequiresReauthorization(reconnect)).toBe(true);
    expect(mailchimpConnectionSummaryLabel(reconnect)).toBe('Reconnect this account to restore updates.');

    const ready = lifecycle('ready', 'Connected and ready.');
    expect(mailchimpConnectionNeedsAttention(ready)).toBe(false);
    expect(mailchimpConnectionRequiresReauthorization(ready)).toBe(false);
    expect(mailchimpConnectionSummaryLabel(ready)).toBe('Connected and ready.');
  });

  it('maps guided setup failures to stable user-facing notice codes', () => {
    expect(mailchimpSetupNoticeCode(new ConnectorError('forbidden', 'token rejected')))
      .toBe('mailchimp-setup-reconnect');
    expect(mailchimpSetupNoticeCode(new ConnectorError('provider-retryable', 'rate limited')))
      .toBe('mailchimp-setup-temporary');
    expect(mailchimpSetupNoticeCode(new ConnectorError('configuration-required', 'missing webhook')))
      .toBe('mailchimp-setup-developer');
    expect(mailchimpSetupNoticeCode(new ConnectorError('not-found', 'audience missing')))
      .toBe('mailchimp-audience-required');
    expect(mailchimpSetupNoticeCode(new Error('unexpected'))).toBe('mailchimp-setup-failed');
  });
});
