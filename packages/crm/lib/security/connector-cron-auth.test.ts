import { describe, expect, it } from 'vitest';
import { authorizeConnectorCronRequest } from './connector-cron-auth';

const secret = 'a-secure-cron-secret-with-at-least-32-characters';

describe('connector cron authentication', () => {
  it('accepts the exact bearer secret and rejects mismatches', () => {
    expect(() => authorizeConnectorCronRequest(`Bearer ${secret}`, secret)).not.toThrow();
    expect(() => authorizeConnectorCronRequest('Bearer wrong', secret)).toThrow(/authorization failed/i);
    expect(() => authorizeConnectorCronRequest(null, secret)).toThrow(/authorization failed/i);
  });

  it('fails closed for missing, short, or header-unsafe configuration', () => {
    expect(() => authorizeConnectorCronRequest(null, undefined)).toThrow(/not configured safely/i);
    expect(() => authorizeConnectorCronRequest(null, 'short')).toThrow(/not configured safely/i);
    expect(() => authorizeConnectorCronRequest(null, `${secret}\nextra`)).toThrow(/not configured safely/i);
  });
});
