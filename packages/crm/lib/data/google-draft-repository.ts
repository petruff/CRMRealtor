import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createGoogleRawTextMessage } from '../domain/google-connector.ts';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '../security/connector-secret-envelope.ts';

function bytea(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ConnectorError('invalid-input', 'Encrypted Google draft is invalid.');
  return `\\x${bytes.toString('hex')}`;
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

export async function createGoogleEmailDraft(input: {
  readonly database: SupabaseClient;
  readonly scope: WorkspaceScope;
  readonly connectionId: string;
  readonly contactId: string;
  readonly contactPointId: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly correlationId: string;
  readonly draftId: string;
  readonly occurredAt: string;
}) {
  const clientMessageId = `${stablePayloadHash({ workspaceId: input.scope.workspaceId,
    connectionId: input.connectionId, draftId: input.draftId })}@omnix.local`;
  const payload = {
    schemaVersion: 'google-gmail-send.v1', contactId: input.contactId,
    contactPointId: input.contactPointId, normalizedRecipient: input.to.trim().toLowerCase(),
    clientMessageId,
    rawMessageBase64Url: createGoogleRawTextMessage({
      from: input.from, to: input.to, subject: input.subject, body: input.body, clientMessageId,
    }),
  };
  const payloadHash = stablePayloadHash(payload);
  const envelope = encryptConnectorSecret(JSON.stringify(payload), {
    workspaceId: input.scope.workspaceId, connectionId: input.connectionId,
    provider: 'google', secretType: 'gmail.send', recordVersion: 1,
  }, createEnvironmentKekResolver());
  const encrypted = {
    ciphertext: bytea(envelope.ciphertext), nonce: bytea(envelope.iv), authTag: bytea(envelope.tag),
    wrappedDek: bytea(envelope.encryptedDek), wrapNonce: bytea(envelope.encryptedDekIv),
    wrapAuthTag: bytea(envelope.encryptedDekTag), kekVersion: envelope.kekVersion,
    aadHash: envelope.aadHash,
  };
  const { data, error } = await input.database.rpc('create_google_email_draft', {
    target_draft_id: input.draftId, target_connection_id: input.connectionId,
    target_contact_id: input.contactId, target_contact_point_id: input.contactPointId,
    target_payload_hash: payloadHash, target_recipient_hash: sha256Hex(input.to.trim().toLowerCase()),
    target_request_key_hash: stablePayloadHash({ draftId: input.draftId, payloadHash }),
    target_envelope: encrypted, target_correlation_id: input.correlationId,
    target_occurred_at: input.occurredAt,
  });
  if (error) throw persistenceError('Failed to create Google email draft', error);
  return data;
}

export async function prepareGoogleEmailDraftIntent(input: {
  readonly database: SupabaseClient;
  readonly draftId: string;
  readonly expectedVersion: number;
  readonly summary: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}) {
  const { data, error } = await input.database.rpc('prepare_google_gmail_send_intent', {
    target_draft_id: input.draftId, target_expected_draft_version: input.expectedVersion,
    target_summary: input.summary, target_correlation_id: input.correlationId,
    target_occurred_at: input.occurredAt,
  });
  if (error) throw persistenceError('Failed to prepare Google email for approval', error);
  return data;
}
