import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { supabaseMailchimpOperationRepository } from './supabase-mailchimp-operation-repository.ts';
import { supabaseMailchimpWebhookRepository } from './supabase-mailchimp-webhook-repository.ts';
import type { MailchimpSetupRepository } from './mailchimp-operation-repository.ts';
import { supabaseMailchimpReconciliationRepository } from './supabase-mailchimp-reconciliation-repository.ts';
import { supabaseMailchimpOutboundBackfillRepository } from './supabase-mailchimp-outbound-backfill-repository.ts';

export interface MailchimpServerRepository {
  readonly operations: MailchimpSetupRepository;
  readonly reconciliations: ReturnType<typeof supabaseMailchimpReconciliationRepository>;
  readonly outboundBackfills: ReturnType<typeof supabaseMailchimpOutboundBackfillRepository>;
}

export function createMailchimpOperationServerRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment ?? process.env;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Mailchimp server authority is not configured.');
  }
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return Object.assign(supabaseMailchimpOperationRepository({
    authenticated: input.authenticated,
    service,
  }), supabaseMailchimpWebhookRepository(service)) as MailchimpSetupRepository;
}

export function createMailchimpServerRepository(input: {
  readonly authenticated: SupabaseClient;
  readonly environment?: Record<string, string | undefined>;
}): MailchimpServerRepository {
  const environment = input.environment ?? process.env;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || (!key.startsWith('ey') && !key.startsWith('sb_secret_'))) {
    throw new ConnectorError('configuration-required', 'Mailchimp server authority is not configured.');
  }
  const service = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const operations = Object.assign(
    supabaseMailchimpOperationRepository({ authenticated: input.authenticated, service }),
    supabaseMailchimpWebhookRepository(service),
  ) as MailchimpSetupRepository;
  return {
    operations,
    reconciliations: supabaseMailchimpReconciliationRepository({ authenticated: input.authenticated, service }),
    outboundBackfills: supabaseMailchimpOutboundBackfillRepository({ authenticated: input.authenticated, service }),
  };
}
