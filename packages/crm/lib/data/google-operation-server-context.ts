import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { supabaseGoogleOperationRepository } from './supabase-google-operation-repository.ts';

export function createGoogleOperationServerRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment ?? process.env;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Google operation server authority is not configured.');
  }
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return supabaseGoogleOperationRepository({ authenticated: input.authenticated, service });
}
