import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readMetaEnquiryReviewContext } from './meta-review-service';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import type { WorkspaceScope } from '../domain/workspace';
import { stablePayloadHash } from '../domain/connector';
import { supabaseMetaOperationRepository } from '../data/meta-operation-repository';

const scope: WorkspaceScope = { authenticatedUserId: 'user-a', ownerUserId: 'user-a', membershipId: 'member-a',
  workspaceId: 'workspace-a', role: 'owner', mode: 'live' };
const connectionId = 'connection-a';

describe('Meta enquiry human review', () => {
  it('decrypts only the reviewer-bound minimized payload and verifies its content hash', async () => {
    const key = randomBytes(32).toString('base64');
    const resolver = { activeVersion: 'v1', resolve: () => Buffer.from(key, 'base64') };
    const payload = { schemaVersion: 'meta-inbound-message.v1', text: 'I would like a tour.', attachmentTypes: [] };
    const contentHash = stablePayloadHash({ text: payload.text, attachmentTypes: payload.attachmentTypes });
    const encrypted = encryptConnectorSecret(JSON.stringify(payload), { workspaceId: scope.workspaceId,
      connectionId, provider: 'meta', secretType: 'meta-inbound-message', recordVersion: 1 }, resolver);
    const service = { rpc: async () => ({ data: { event: { id: 'event-a', workspaceId: scope.workspaceId,
      connectionId, state: 'review', contentHash, incompleteRecordId: 'incomplete-a',
      providerOccurredAt: '2026-08-12T12:00:00Z' }, provenance: { eventKeyHash: 'a'.repeat(64) },
      payloadEnvelope: { envelopeVersion: 1, canonicalHash: contentHash, ciphertext: encrypted.ciphertext,
        nonce: encrypted.iv, authTag: encrypted.tag, wrappedDek: encrypted.encryptedDek,
        wrapNonce: encrypted.encryptedDekIv, wrapAuthTag: encrypted.encryptedDekTag,
        kekVersion: encrypted.kekVersion, aadHash: encrypted.aadHash } }, error: null }) };
    await expect(readMetaEnquiryReviewContext({ service: service as never, scope, eventId: 'event-a', resolver }))
      .resolves.toEqual({ eventId: 'event-a', incompleteRecordId: 'incomplete-a',
        textPreview: 'I would like a tour.', attachmentTypes: [], providerOccurredAt: '2026-08-12T12:00:00Z',
        sourceReference: 'aaaaaaaaaaaa' });
  });

  it('guards the selected contact and rechecks its epoch before resolving Meta review', async () => {
    const calls: string[] = [];
    const service = { rpc: async (name: string, input: Record<string, unknown>) => {
      calls.push(name);
      if (name === 'assert_contact_outbound_target') return { data: {
        contactId: input.target_contact_id, contactPointId: null, aliasEpoch: 5,
      }, error: null };
      return { data: { noOp: false }, error: null };
    } };
    await expect(supabaseMetaOperationRepository(service as never).resolveReview(scope, {
      eventId: 'event-a', contactId: 'contact-a', correlationId: 'correlation-a',
    })).resolves.toEqual({ noOp: false });
    expect(calls).toEqual(['assert_contact_outbound_target', 'assert_contact_outbound_target', 'resolve_meta_enquiry_review']);
  });
});
