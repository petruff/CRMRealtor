import { createClient } from '@supabase/supabase-js';
import { AttentionError } from '../domain/attention.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { validateWorkspaceScope } from '../domain/workspace.ts';
import { supabaseAttentionRepository } from './supabase-attention-repository.ts';

/**
 * Creates the privileged write seam only after the caller has derived a live
 * workspace scope from the authenticated server session.
 */
export function createAttentionAutomationServerRepository(
  untrustedScope: WorkspaceScope,
  environment: Record<string, string | undefined> = process.env,
) {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') {
    throw new AttentionError('scope-mismatch', 'Attention automation requires a live workspace.');
  }
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new AttentionError('forbidden', 'Attention automation server authority is not configured.');
  }
  return supabaseAttentionRepository(createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }));
}
