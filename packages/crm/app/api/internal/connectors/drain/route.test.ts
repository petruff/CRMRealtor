import { describe, expect, it, vi } from 'vitest';
import { handleConnectorDrainRequest } from './handler';

const secret = 'a-secure-cron-secret-with-at-least-32-characters';

describe('connector drain route', () => {
  it('rejects missing or mismatched cron authorization without running a worker', async () => {
    const drain = vi.fn();
    const response = await handleConnectorDrainRequest(
      new Request('http://localhost/api/internal/connectors/drain'),
      { cronSecret: secret, drain },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'unauthorized' });
    expect(drain).not.toHaveBeenCalled();
  });

  it('returns only bounded aggregate results for an authorized drain', async () => {
    const response = await handleConnectorDrainRequest(
      new Request('http://localhost/api/internal/connectors/drain', {
        headers: { authorization: `Bearer ${secret}` },
      }),
      {
        cronSecret: secret,
        drain: async () => ({
          claimed: 2, reconciliationClaimed: 1, succeeded: 2, deferred: 1, failed: 0, swept: 0,
          revocations: { claimed: 1, confirmed: 1, deferred: 0, unconfirmed: 0 },
          mailchimpWebhooks: { claimed: 1, succeeded: 1, deferred: 0, review: 0 },
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      schemaVersion: 'connector-drain.v1',
      result: {
        claimed: 2,
        revocations: { claimed: 1, confirmed: 1, unconfirmed: 0 },
        mailchimpWebhooks: { claimed: 1, succeeded: 1, review: 0 },
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|payload|workspace|jobIds/i);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('fails closed when the worker is not configured and logs only a fixed category', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleConnectorDrainRequest(
      new Request('http://localhost/api/internal/connectors/drain', {
        headers: { authorization: `Bearer ${secret}` },
      }),
      { cronSecret: secret, drain: async () => { throw new Error('Bearer private-token'); } },
    );
    expect(response.status).toBe(503);
    expect(String(error.mock.calls[0]?.[0])).not.toContain('private-token');
    error.mockRestore();
  });
});
