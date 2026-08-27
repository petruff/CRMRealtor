import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorRepository } from '@/lib/data/connector-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';

const configured = vi.fn(() => false);
const serverClient = vi.fn();
const repositoryContext = vi.fn();
const lifecycleSnapshot = vi.fn();

vi.mock('@/lib/supabase/env', () => ({ isSupabaseConfigured: () => configured() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => serverClient() }));
vi.mock('@/lib/data', () => ({ getRepository: () => repositoryContext() }));
vi.mock('@/lib/application/connector-lifecycle-orchestrator', () => ({
  readConnectorLifecycleSnapshot: (...args: unknown[]) => lifecycleSnapshot(...args),
  connectorLifecycleReadiness: (lifecycles: Array<{ provider: string; state: string }>) => lifecycles.map((lifecycle) => ({
    id: `connector-${lifecycle.provider}`,
    configured: lifecycle.state !== 'not-configured',
    status: lifecycle.state,
  })),
}));

import { GET } from './route.ts';

describe('readiness', () => {
  beforeEach(() => {
    configured.mockReturnValue(false);
    serverClient.mockReset();
    repositoryContext.mockReset();
    lifecycleSnapshot.mockReset();
  });

  it('returns non-200 without leaking configuration', async () => {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/key|url|tenant/i);
  });

  it('uses the canonical server snapshot for authenticated connector readiness', async () => {
    configured.mockReturnValue(true);
    serverClient.mockResolvedValue({
      from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }),
    });
    const connectorRepository = {
      listDefinitions: vi.fn(async () => [{
        provider: 'google', label: 'Google', mode: 'live', enabled: true,
        capabilities: [], productionRequirements: [],
      }]),
      listConnections: vi.fn(async () => [{
        id: 'connection-google', workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
        provider: 'google', remoteAccountId: 'redacted', grantedScopes: [], status: 'active',
        connectedAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T11:00:00.000Z',
      }]),
    } as unknown as ConnectorRepository;
    repositoryContext.mockResolvedValue({
      isLive: true,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      connectorRepository,
    });
    lifecycleSnapshot.mockResolvedValue({
      lifecycles: [{
        provider: 'google', connectionId: 'connection-google', state: 'ready',
        grantedScopes: [], missingScopes: [], baseline: 'not-applicable', webhook: 'not-applicable',
        providerEvidence: 'current', ownerAction: 'none', safeSummary: 'Connected and ready.',
        observedAt: '2026-08-25T12:00:00.000Z',
      }],
    });

    const response = await GET();
    const body = await response.json();
    expect(body.dependencies).toContainEqual({
      id: 'connector-google', configured: true, status: 'ready',
    });
    expect(lifecycleSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      connectorRepository,
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      isLive: true,
    }));
    expect(JSON.stringify(body)).not.toMatch(/scope.*googleapis|oauth|hash|uat/i);
  });
});
