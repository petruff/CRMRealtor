import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';

const harness = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'assistant',
  fail: false,
  isLive: true,
}));

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    isLive: harness.isLive,
    workspaceScope: { ...SAMPLE_WORKSPACE_SCOPE, role: harness.role },
    workspaceRepository: {
      health: async () => {
        if (harness.fail) throw new Error('provider unavailable');
        return {
          schemaVersion: 'workspace-health.v1',
          mode: 'sample',
          durable: false,
          status: 'healthy',
          checkedAt: '2026-08-11T00:00:00.000Z',
          checks: [{ id: 'authority-model', status: 'pass', message: 'Authority is scoped.' }],
        };
      },
    },
  }),
}));

import { GET } from './route';

beforeEach(() => {
  harness.role = 'owner';
  harness.fail = false;
  harness.isLive = true;
});

describe('GET /api/workspace/health', () => {
  it('returns a redacted owner health result', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      product: 'Omnix',
      mode: 'live',
      health: { status: 'healthy' },
    });
  });

  it('does not expose workspace health to signed-out or unconfigured sample callers', async () => {
    harness.isLive = false;
    const response = await GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      product: 'Omnix',
      mode: 'sample',
      message: 'Sign in to inspect authenticated workspace health.',
    });
  });

  it('refuses assistants and fails safely without provider detail', async () => {
    harness.role = 'assistant';
    expect((await GET()).status).toBe(403);

    harness.role = 'owner';
    harness.fail = true;
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: 'Workspace health is unavailable.',
    });
  });
});
