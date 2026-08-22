import { createClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { supabaseMailchimpWebhookRepository } from './supabase-mailchimp-webhook-repository.ts';

export function createMailchimpWebhookServerRepository(
  environment: Record<string, string | undefined> = process.env,
) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Mailchimp webhook server authority is not configured.');
  }
  return supabaseMailchimpWebhookRepository(createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }));
}
