import { describe, expect, it, vi } from 'vitest';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import { supabaseMailchimpWebhookRepository } from './supabase-mailchimp-webhook-repository';

const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 2) };
const occurredAt = '2026-08-11T12:00:00.000Z';

describe('Supabase Mailchimp webhook repository', () => {
  it('reads redacted setup state and binds an encrypted per-connection signing secret', async () => {
    const secretEnvelope = encryptConnectorSecret('signing-secret', {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'mailchimp-webhook-signing-secret', recordVersion: 1,
    }, resolver);
    const rpc = vi.fn(async (name: string) => name === 'read_mailchimp_webhook_setup_state'
      ? { data: { workspaceId: 'workspace-a', connectionId: 'connection-a', secretVersion: null, webhookRegistrationRequired: true, endpointBound: false }, error: null }
      : { data: { secret: { secretVersion: 1 }, noOp: false }, error: null });
    const repository = supabaseMailchimpWebhookRepository({ rpc } as never);
    await expect(repository.readSetupState('connection-a')).resolves.toEqual({
      workspaceId: 'workspace-a', connectionId: 'connection-a', webhookRegistrationRequired: true, endpointBound: false,
    });
    await expect(repository.bindSigningSecret({
      connectionId: 'connection-a', endpointKeyHash: 'a'.repeat(64), webhookIdHash: 'b'.repeat(64),
      envelope: secretEnvelope, occurredAt, correlationId: '11111111-1111-4111-8111-111111111111',
    })).resolves.toEqual({ secretVersion: 1, noOp: false });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('signing-secret');
  });

  it('atomically registers encrypted webhook data and maps leased work without plaintext', async () => {
    const event = {
      eventId: 'e'.repeat(64), audienceId: 'audience-a', memberId: 'member-a',
      normalizedEmail: 'ada@example.com', subscriptionStatus: 'unsubscribed' as const, occurredAt,
      origin: 'mailchimp-webhook' as const,
    };
    const eventEnvelope = encryptConnectorSecret(JSON.stringify(event), {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'mailchimp.webhook', recordVersion: 1,
    }, resolver);
    const signingSecretEnvelope = encryptConnectorSecret('signing-secret', {
      workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
      secretType: 'mailchimp-webhook-signing-secret', recordVersion: 1,
    }, resolver);
    const row = {
      id: 'job-a', workspace_id: 'workspace-a', connection_id: 'connection-a', binding_id: 'binding-a',
      delivery_id: 'delivery-a', fencing_token: 1, attempt_count: 0, max_attempts: 5,
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === 'read_mailchimp_webhook_signing_secret') return { data: {
        workspaceId: 'workspace-a', connectionId: 'connection-a',
        audienceBinding: { bindingId: 'binding-a', audienceId: 'audience-a' },
        endpointBinding: { bindingId: 'endpoint-a' },
        secret: { secretVersion: 1, ciphertext: signingSecretEnvelope.ciphertext, nonce: signingSecretEnvelope.iv,
          authTag: signingSecretEnvelope.tag, wrappedDek: signingSecretEnvelope.encryptedDek,
          wrapNonce: signingSecretEnvelope.encryptedDekIv, wrapAuthTag: signingSecretEnvelope.encryptedDekTag,
          kekVersion: signingSecretEnvelope.kekVersion, aadHash: signingSecretEnvelope.aadHash },
      }, error: null };
      if (name === 'register_mailchimp_webhook_event_encrypted') return { data: { accepted: true, noOp: false, webhookJob: row }, error: null };
      if (name === 'claim_mailchimp_webhook_jobs') return { data: [row], error: null };
      if (name === 'start_mailchimp_webhook_job') return { data: { webhookJob: { ...row, attempt_count: 1 } }, error: null };
      if (name === 'read_claimed_mailchimp_webhook_payload') return { data: {
        audienceId: 'audience-a', payload: { ciphertext: eventEnvelope.ciphertext, nonce: eventEnvelope.iv,
          authTag: eventEnvelope.tag, wrappedDek: eventEnvelope.encryptedDek,
          wrapNonce: eventEnvelope.encryptedDekIv, wrapAuthTag: eventEnvelope.encryptedDekTag,
          kekVersion: eventEnvelope.kekVersion, aadHash: eventEnvelope.aadHash, envelopeVersion: 1 },
      }, error: null };
      return { data: { outcome: 'applied' }, error: null };
    });
    const repository = supabaseMailchimpWebhookRepository({ rpc } as never);
    const authority = await repository.readSigningAuthority('a'.repeat(64), occurredAt);
    await expect(repository.register({
      authority, event, replayKeyHash: 'b'.repeat(64), rawBodyHash: 'c'.repeat(64),
      payloadHash: 'd'.repeat(64), correlationId: '11111111-1111-4111-8111-111111111111',
      receivedAt: occurredAt, envelope: eventEnvelope,
    })).resolves.toEqual({ accepted: true, duplicate: false, jobId: 'job-a' });
    const [job] = await repository.claim({ workerId: 'worker-a', batchSize: 10, leaseSeconds: 90, now: occurredAt });
    const started = await repository.start({ job: job!, workerId: 'worker-a', now: occurredAt });
    await expect(repository.readPayload({ job: started, workerId: 'worker-a', now: occurredAt }))
      .resolves.toMatchObject({ audienceId: 'audience-a', envelopeVersion: 1 });
    expect(rpc).toHaveBeenCalledWith('register_mailchimp_webhook_event_encrypted', expect.objectContaining({
      target_connection_id: 'connection-a', target_payload_hash: 'd'.repeat(64),
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('ada@example.com');
  });
});
