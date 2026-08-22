import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createEnvironmentKekResolver, decryptConnectorSecret,
  type ConnectorKekResolver, type ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `Meta ${field} is invalid.`);
  return value;
}
function envelope(value: unknown): { value: ConnectorSecretEnvelope; version: number; canonicalHash: string } {
  const row = object(value, 'Meta review payload envelope is invalid.');
  const version = Number(row.envelopeVersion);
  if (!Number.isSafeInteger(version) || version < 1) throw new ConnectorError('conflict', 'Meta review payload version is invalid.');
  return { version, canonicalHash: text(row.canonicalHash, 'content hash'), value: {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'),
  } };
}

export interface MetaReviewContext {
  readonly eventId: string; readonly incompleteRecordId: string; readonly textPreview?: string;
  readonly attachmentTypes: readonly string[]; readonly providerOccurredAt: string; readonly sourceReference: string;
}

export async function readMetaEnquiryReviewContext(input: {
  readonly service: SupabaseClient; readonly scope: WorkspaceScope; readonly eventId: string;
  readonly resolver?: ConnectorKekResolver; readonly now?: Date;
}): Promise<MetaReviewContext> {
  if (input.scope.mode !== 'live' || !['owner', 'assistant'].includes(input.scope.role)) {
    throw new ConnectorError('forbidden', 'A live workspace reviewer is required.');
  }
  const { data, error } = await input.service.rpc('read_meta_enquiry_review_authority', {
    target_event_id: input.eventId, target_authenticated_user_id: input.scope.authenticatedUserId,
    target_membership_id: input.scope.membershipId, target_now: (input.now ?? new Date()).toISOString(),
  });
  if (error) {
    if (error.code === '42501') throw new ConnectorError('forbidden', 'Meta review authority is unavailable.');
    if (error.code === 'P0002') throw new ConnectorError('not-found', 'Meta review content is unavailable.');
    throw new Error('Meta review authority persistence failed.');
  }
  const root = object(data, 'Meta review authority is invalid.');
  const event = object(root.event, 'Meta review event is invalid.');
  const provenance = object(root.provenance, 'Meta review provenance is invalid.');
  if (event.workspaceId !== input.scope.workspaceId || event.id !== input.eventId || event.state !== 'review') {
    throw new ConnectorError('forbidden', 'Meta review workspace binding failed.');
  }
  const encrypted = envelope(root.payloadEnvelope);
  if (encrypted.canonicalHash !== event.contentHash) throw new ConnectorError('conflict', 'Meta review content authority changed.');
  const plaintext = decryptConnectorSecret(encrypted.value, { workspaceId: input.scope.workspaceId,
    connectionId: text(event.connectionId, 'connection id'), provider: 'meta',
    secretType: 'meta-inbound-message', recordVersion: encrypted.version,
  }, input.resolver ?? createEnvironmentKekResolver());
  const payload = object(JSON.parse(plaintext), 'Meta review content payload is invalid.');
  const attachmentTypes = Array.isArray(payload.attachmentTypes)
    ? payload.attachmentTypes.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  const contentHash = stablePayloadHash({ text: typeof payload.text === 'string' ? payload.text : undefined,
    attachmentTypes });
  if (payload.schemaVersion !== 'meta-inbound-message.v1' || contentHash !== encrypted.canonicalHash) {
    throw new ConnectorError('conflict', 'Meta review content failed integrity verification.');
  }
  const rawText = typeof payload.text === 'string' ? payload.text.replace(/[\u0000\u007f]/g, '').trim() : '';
  return { eventId: input.eventId, incompleteRecordId: text(event.incompleteRecordId, 'incomplete record id'),
    ...(rawText ? { textPreview: rawText.slice(0, 500) } : {}), attachmentTypes,
    providerOccurredAt: text(event.providerOccurredAt, 'provider time'),
    sourceReference: text(provenance.eventKeyHash, 'source reference').slice(0, 12) };
}
