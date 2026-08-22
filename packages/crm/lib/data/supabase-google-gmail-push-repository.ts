import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import type { GoogleGmailPushRepository } from '../application/google-gmail-push-service.ts';

export function supabaseGoogleGmailPushRepository(client: SupabaseClient): GoogleGmailPushRepository {
  return {
    async register(input) {
      const { data, error } = await client.rpc('register_google_gmail_push_wakeup', {
        target_endpoint_key_hash: input.endpointKeyHash,
        target_exact_external_url_hash: input.exactExternalUrlHash,
        target_subscription_hash: input.subscriptionHash,
        target_oidc_audience_hash: input.oidcAudienceHash,
        target_pubsub_message_id_hash: input.pubsubMessageIdHash,
        target_account_email_hash: input.accountEmailHash,
        target_history_id_hash: input.historyIdHash,
        target_published_at: input.publishedAt,
        target_received_at: input.receivedAt,
        target_correlation_id: input.correlationId,
      });
      if (error) {
        if (error.code === '42501') throw new ConnectorError('forbidden', 'Google Gmail push authority is unavailable.');
        if (error.code === '23505') throw new ConnectorError('conflict', 'Google Gmail push replay conflicts.');
        if (error.code === '22023') throw new ConnectorError('invalid-input', 'Google Gmail push evidence is invalid.');
        throw new Error('Failed to register Google Gmail push wake-up.');
      }
      const row = data as Record<string, unknown> | null;
      return { accepted: row?.accepted === true, noOp: row?.noOp === true };
    },
  };
}
