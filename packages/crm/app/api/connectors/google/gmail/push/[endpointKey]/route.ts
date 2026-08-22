import { createClient } from '@supabase/supabase-js';
import { loadGoogleGmailPushConfiguration } from '@/lib/config/google-gmail-push';
import { supabaseGoogleGmailPushRepository } from '@/lib/data/supabase-google-gmail-push-repository';
import { handleGoogleGmailPush } from './handler';

export async function POST(request: Request, context: { params: Promise<{ endpointKey: string }> }) {
  const { endpointKey } = await context.params;
  try {
    const configuration = loadGoogleGmailPushConfiguration();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) throw new Error('unconfigured');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return handleGoogleGmailPush(request, {
      endpointKey, configuration, repository: supabaseGoogleGmailPushRepository(client),
    });
  } catch {
    return Response.json({ ok: false, code: 'unavailable' }, { status: 503 });
  }
}
