import { ConnectorError } from '../domain/connector.ts';

export interface ConnectorOAuthRouteEvent {
  readonly schemaVersion: 'connector-oauth-route.v1';
  readonly provider: 'google' | 'mailchimp';
  readonly operation: 'oauth-begin' | 'oauth-callback';
  readonly stage: string;
  readonly outcome: 'succeeded' | 'denied' | 'failed';
  readonly category: string;
  readonly supportReference: string;
}

export function connectorOAuthSupportReference(correlationId: string): string {
  return correlationId.replaceAll('-', '').slice(0, 8).toUpperCase();
}

export function connectorOAuthRouteEvent(input: {
  readonly provider: 'google' | 'mailchimp';
  readonly operation: 'oauth-begin' | 'oauth-callback';
  readonly stage: string;
  readonly outcome: 'succeeded' | 'denied' | 'failed';
  readonly correlationId: string;
  readonly error?: unknown;
}): ConnectorOAuthRouteEvent {
  return {
    schemaVersion: 'connector-oauth-route.v1',
    provider: input.provider,
    operation: input.operation,
    stage: input.stage.replace(/[^a-z0-9-]/g, '').slice(0, 48) || 'unknown',
    outcome: input.outcome,
    category: input.error instanceof ConnectorError
      ? input.error.code
      : input.outcome === 'denied' ? 'forbidden' : input.outcome === 'succeeded' ? 'none' : 'internal-error',
    supportReference: connectorOAuthSupportReference(input.correlationId),
  };
}

export function recordConnectorOAuthRouteEvent(
  input: Parameters<typeof connectorOAuthRouteEvent>[0],
): void {
  const event = connectorOAuthRouteEvent(input);
  const write = event.outcome === 'failed' ? console.error : console.info;
  write(JSON.stringify(event));
}
