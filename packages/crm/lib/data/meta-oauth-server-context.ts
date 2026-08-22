import { createClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { supabaseMetaOAuthRepository } from './supabase-meta-oauth-repository.ts';

export function createMetaOAuthServerRepository(input: { authenticated: import('@supabase/supabase-js').SupabaseClient }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Meta OAuth service authority is not configured.');
  }
  return supabaseMetaOAuthRepository({
    authenticated: input.authenticated,
    service: createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }),
  });
}

