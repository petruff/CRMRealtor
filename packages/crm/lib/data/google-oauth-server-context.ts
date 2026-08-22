import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { supabaseGoogleOAuthRepository } from './supabase-google-oauth-repository.ts';

export function createGoogleOAuthServerRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment ?? process.env;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Google OAuth server authority is not configured.');
  }
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return supabaseGoogleOAuthRepository({ authenticated: input.authenticated, service });
}
