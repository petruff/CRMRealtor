import {
  connectorLifecycleReadiness,
  readConnectorLifecycleSnapshot,
} from '@/lib/application/connector-lifecycle-orchestrator';
import { getRepository } from '@/lib/data';
import type { ConnectorLifecycleProjection } from '@/lib/domain/connector-lifecycle';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function databaseAvailable(configured: boolean): Promise<boolean> {
  if (!configured) return false;
  try {
    const client = await createSupabaseServerClient();
    const { error } = await client.from('workspaces').select('id', { head: true, count: 'exact' }).limit(1);
    return !error;
  } catch {
    return false;
  }
}
async function authenticatedConnectorLifecycles(): Promise<readonly ConnectorLifecycleProjection[]> {
  try {
    const context = await getRepository();
    if (!context.isLive) return [];
    return (await readConnectorLifecycleSnapshot({
      connectorRepository: context.connectorRepository,
      workspaceScope: context.workspaceScope,
      isLive: context.isLive,
    })).lifecycles;
  } catch {
    return [];
  }
}

export async function GET() {
  const configured = isSupabaseConfigured();
  const database = await databaseAvailable(configured);
  const connectors = database ? await authenticatedConnectorLifecycles() : [];
  return Response.json({
    ok: database,
    product: 'Omnix',
    schemaVersion: 'readiness.v2',
    dependencies: [
      { id: 'database', configured, status: database ? 'available' : 'unavailable' },
      ...connectorLifecycleReadiness(connectors),
    ],
  }, {
    status: database ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
