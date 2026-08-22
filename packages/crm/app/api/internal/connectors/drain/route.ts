import {
  drainConfiguredConnectorServiceJobs,
} from '@/lib/application/connector-service-worker';
import { handleConnectorDrainRequest } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleConnectorDrainRequest(request, {
    cronSecret: process.env.CRON_SECRET,
    drain: () => drainConfiguredConnectorServiceJobs(process.env),
  });
}
