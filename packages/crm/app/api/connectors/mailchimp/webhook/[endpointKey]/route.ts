import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMailchimpWebhookServerRepository } from '@/lib/data/mailchimp-webhook-server-context';
import { handleMailchimpWebhookPost, handleMailchimpWebhookValidation } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly endpointKey: string }> };

function dependencies() {
  loadMailchimpConfiguredRuntimeConfiguration();
  return {
    repository: createMailchimpWebhookServerRepository(),
  };
}

export async function GET(_request: Request, context: Context) {
  try {
    loadMailchimpConfiguredRuntimeConfiguration();
    return handleMailchimpWebhookValidation((await context.params).endpointKey);
  } catch {
    return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    return handleMailchimpWebhookPost(request, (await context.params).endpointKey, dependencies());
  } catch {
    return Response.json({ ok: false, code: 'unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}
