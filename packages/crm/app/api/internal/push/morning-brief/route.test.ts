import { afterEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/application/morning-brief-sender', () => ({ sendConfiguredMorningBriefs: send }));

import { GET } from './route';

const SECRET = 'x'.repeat(40);

describe('morning brief cron route', () => {
  afterEach(() => { send.mockReset(); vi.unstubAllEnvs(); });

  it('refuses requests without the cron bearer secret', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    const response = await GET(new Request('https://crm.example.com/api/internal/push/morning-brief', { headers: { authorization: 'Bearer wrong' } }));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it('runs the sender for an authorized cron call', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    send.mockResolvedValue({ day: '2026-09-23', sent: 1, alreadySent: 0, nothingToSend: 0, revoked: 0, failed: 0 });
    const response = await GET(new Request('https://crm.example.com/api/internal/push/morning-brief', { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { sent: 1 } });
  });

  it('reports missing configuration without leaking details', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    send.mockRejectedValue(new Error('Morning brief notifications are not configured.'));
    const response = await GET(new Request('https://crm.example.com/api/internal/push/morning-brief', { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'not-configured' });
  });
});
