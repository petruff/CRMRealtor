import { describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@/lib/domain/connector';
import {
  classifyMailchimpAudienceLoadIssue,
  mailchimpConnectionStatusLabel,
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
});
