import { loadMetaConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMetaWebhookServerRepository } from '@/lib/data/meta-webhook-server-context';
import { handleMetaWebhookChallenge, handleMetaWebhookDelivery } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly endpointKey: string }> };

function dependencies(endpointKey: string) {
  loadMetaConfiguredRuntimeConfiguration();
  const configured = process.env.META_WEBHOOK_ENDPOINT_KEY?.trim();
  if (!configured || configured !== endpointKey) throw new Error('Meta endpoint is unavailable.');
  return { repository: createMetaWebhookServerRepository(), endpointKey };
}

export async function GET(request: Request, context: Context) {
  try {
    const endpointKey = (await context.params).endpointKey;
    return handleMetaWebhookChallenge(request, dependencies(endpointKey));
  } catch {
    return Response.json({ ok: false, code: 'not-found' }, {
      status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const endpointKey = (await context.params).endpointKey;
    return handleMetaWebhookDelivery(request, dependencies(endpointKey));
  } catch {
    return Response.json({ ok: false, code: 'unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}

