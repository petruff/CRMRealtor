import { loadTwilioConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createTwilioWebhookServerRepository } from '@/lib/data/twilio-webhook-server-context';
import { loadTwilioConfiguration } from '@/lib/providers/twilio-client';
import { handleTwilioWebhook } from '../../handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ endpointKey: string }> },
) {
  try {
    loadTwilioConfiguredRuntimeConfiguration();
    const configuration = loadTwilioConfiguration();
    const { endpointKey } = await context.params;
    if (endpointKey !== configuration.callbackEndpointKey) {
      return Response.json({ ok: false, code: 'not-found' }, { status: 404 });
    }
    return handleTwilioWebhook(request, 'inbound', {
      repository: createTwilioWebhookServerRepository(),
      externalBaseUrl: configuration.callbackBaseUrl,
      endpointKey,
    });
  } catch {
    return Response.json({ ok: false, code: 'unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
