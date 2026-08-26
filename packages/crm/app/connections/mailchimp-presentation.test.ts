import { describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@/lib/domain/connector';
import {
  classifyMailchimpAudienceLoadIssue,
  mailchimpConnectionNeedsAttention,
  mailchimpConnectionRequiresReauthorization,
  mailchimpConnectionSummaryLabel,
  mailchimpConnectionStatusLabel,
  mailchimpSetupNoticeCode,
  recordMailchimpReadFailure,
} from './mailchimp-presentation';

describe('Mailchimp connection presentation', () => {
  it('asks for reconnection only when provider authorization is rejected', () => {
    expect(classifyMailchimpAudienceLoadIssue(new ConnectorError('forbidden', 'provider rejected token')).kind)
      .toBe('reconnect');
    expect(classifyMailchimpAudienceLoadIssue(new ConnectorError('provider-retryable', 'rate limited')).kind)
      .toBe('temporary');
    expect(classifyMailchimpAudienceLoadIssue(new Error('database unavailable')).kind)
      .toBe('developer');
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

  it('translates persisted connector states into customer language', () => {
    expect(mailchimpConnectionStatusLabel('active')).toBe('Connected');
    expect(mailchimpConnectionStatusLabel('reauthorization-required')).toBe('Reconnect required');
    expect(mailchimpConnectionStatusLabel('unexpected')).toBe('Connection status unavailable');
  });

  it('does not present a saved connection as healthy when live account reads fail', () => {
    const issue = classifyMailchimpAudienceLoadIssue(new ConnectorError('forbidden', 'token rejected'));
    expect(mailchimpConnectionNeedsAttention('active', issue)).toBe(true);
    expect(mailchimpConnectionRequiresReauthorization('active', issue)).toBe(true);
    expect(mailchimpConnectionSummaryLabel('active', issue)).toBe('Mailchimp needs to be reconnected');
    expect(mailchimpConnectionNeedsAttention('active')).toBe(false);
    expect(mailchimpConnectionRequiresReauthorization('active')).toBe(false);
    expect(mailchimpConnectionSummaryLabel('active')).toBe('Connected');

    const temporary = classifyMailchimpAudienceLoadIssue(new ConnectorError('provider-retryable', 'rate limited'));
    expect(mailchimpConnectionNeedsAttention('active', temporary)).toBe(true);
    expect(mailchimpConnectionRequiresReauthorization('active', temporary)).toBe(false);
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
