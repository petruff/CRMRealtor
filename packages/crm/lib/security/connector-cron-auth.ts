import { timingSafeEqual } from 'node:crypto';
import { ConnectorError } from '../domain/connector.ts';

export function authorizeConnectorCronRequest(
  authorization: string | null,
  configuredSecret: string | undefined,
): void {
  const secret = configuredSecret?.trim();
  if (!secret || secret.length < 32 || secret.length > 512 || /[\r\n]/.test(secret)) {
    throw new ConnectorError('configuration-required', 'Connector cron authentication is not configured safely.');
  }
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const received = Buffer.from(authorization ?? '', 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new ConnectorError('forbidden', 'Connector cron authorization failed.');
  }
}
