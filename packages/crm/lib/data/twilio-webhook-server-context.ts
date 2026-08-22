import { createClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { supabaseTwilioWebhookRepository } from './supabase-twilio-webhook-repository.ts';

export function createTwilioWebhookServerRepository(
  environment: Record<string, string | undefined> = process.env,
) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Twilio webhook server authority is not configured.');
  }
  return supabaseTwilioWebhookRepository(createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }));
}

