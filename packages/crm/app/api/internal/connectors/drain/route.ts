import {
  drainConfiguredConnectorServiceJobs,
} from '@/lib/application/connector-service-worker';
import { handleConnectorDrainRequest } from './handler';
import { reconcileConfiguredAttention } from '@/lib/application/attention-service-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleConnectorDrainRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    drain: async () => {
      const connectors = await drainConfiguredConnectorServiceJobs(process.env);
      try {
        return { ...connectors, attention: await reconcileConfiguredAttention(process.env) };
      } catch (error) {
        console.error(JSON.stringify({
          schemaVersion: 'attention-reconciliation-error.v1',
          category: 'attention-unavailable',
          message: error instanceof Error ? error.message : 'Attention reconciliation failed.',
        }));
        return { ...connectors, attention: { availability: 'unavailable' as const } };
      }
    },
  });
}
