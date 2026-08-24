import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../domain/connector';
import { connectorOAuthRouteEvent } from './connector-oauth-route-telemetry';

describe('connector OAuth route telemetry', () => {
  it('emits a fixed secret-free diagnostic envelope', () => {
    const event = connectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-callback', stage: 'persistence-completion',
      outcome: 'failed', correlationId: '12345678-1234-4000-8000-123456789abc',
      error: new ConnectorError('conflict', 'Bearer secret@example.com token=secret'),
    });
    expect(event).toEqual({
      schemaVersion: 'connector-oauth-route.v1', provider: 'google', operation: 'oauth-callback',
      stage: 'persistence-completion', outcome: 'failed', category: 'conflict',
      supportReference: '12345678',
    });
    expect(JSON.stringify(event)).not.toContain('secret@example.com');
    expect(JSON.stringify(event)).not.toContain('Bearer');
  });
});
