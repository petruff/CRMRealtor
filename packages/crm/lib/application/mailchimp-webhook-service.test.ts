import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  MailchimpWebhookJob,
  SupabaseMailchimpWebhookRepository,
} from '../data/supabase-mailchimp-webhook-repository';
import { sha256Hex, stablePayloadHash } from '../domain/connector';
import { parseMailchimpMarketingWebhookForm } from '../providers/mailchimp-webhook';
import { encryptConnectorSecret } from '../security/connector-secret-envelope';
import { drainMailchimpWebhookJobs, ingestMailchimpWebhook } from './mailchimp-webhook-service';

const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 7) };
const now = new Date('2026-08-11T12:00:00.000Z');
const raw = Buffer.from('type=unsubscribe&fired_at=2026-08-11+12%3A00%3A00&data%5Bid%5D=member-a&data%5Blist_id%5D=audience-a&data%5Bemail%5D=Ada%40Example.com&data%5Baction%5D=unsub');
const timestamp = Math.floor(now.getTime() / 1_000);
const secret = 'mailchimp-signing-secret';
const signature = createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest('hex');

function repository(): SupabaseMailchimpWebhookRepository {
  const signingSecretEnvelope = encryptConnectorSecret(secret, {
    workspaceId: 'workspace-a', connectionId: 'connection-a', provider: 'mailchimp',
    secretType: 'mailchimp-webhook-signing-secret', recordVersion: 1,
  }, resolver);
  return {
    readSetupState: vi.fn(), bindSigningSecret: vi.fn(), applyBaselineMember: vi.fn(), completeBaseline: vi.fn(),
    readSigningAuthority: vi.fn(async () => ({
      workspaceId: 'workspace-a', connectionId: 'connection-a', audienceBindingId: 'binding-a',
      audienceId: 'audience-a', endpointBindingId: 'endpoint-a', secretVersion: 1, signingSecretEnvelope,
    })),
    register: vi.fn(async () => ({ accepted: true, duplicate: false, jobId: 'job-a' })),
    claim: vi.fn(async () => []), start: vi.fn(), readPayload: vi.fn(), apply: vi.fn(), transition: vi.fn(),
  };
}

describe('Mailchimp webhook service', () => {
  it('verifies raw bytes before parsing and stores only encrypted normalized data', async () => {
    const repo = repository();
    await expect(ingestMailchimpWebhook({
      repository: repo, endpointKey: 'a'.repeat(48), rawBody: raw,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      now, correlationId: '11111111-1111-4111-8111-111111111111', resolver,
    })).resolves.toEqual({ accepted: true, duplicate: false, jobId: 'job-a' });
    expect(repo.readSigningAuthority).toHaveBeenCalledWith(sha256Hex('a'.repeat(48)), now.toISOString());
    const registered = vi.mocked(repo.register).mock.calls[0]?.[0];
    expect(registered?.event).toMatchObject({ normalizedEmail: 'ada@example.com', subscriptionStatus: 'unsubscribed' });
    expect(JSON.stringify(registered?.envelope)).not.toContain('ada@example.com');
    expect(registered?.payloadHash).toBe(stablePayloadHash(registered!.event));
    expect(repo.register).toHaveBeenCalledWith(expect.objectContaining({ rawBodyHash: sha256Hex(raw) }));
  });

  it('rejects a bad signature before parsing or payload persistence', async () => {
    const repo = repository();
    await expect(ingestMailchimpWebhook({
      repository: repo, endpointKey: 'b'.repeat(48), rawBody: Buffer.from('not-form'),
      signatureHeader: `t=${timestamp},v1=${'0'.repeat(64)}`, now, resolver,
    })).rejects.toThrow(/signature verification/i);
    expect(repo.register).not.toHaveBeenCalled();
  });

  it('drains a leased unsubscribe and records a successful transition', async () => {
    const event = parseMailchimpMarketingWebhookForm(raw);
    const job: MailchimpWebhookJob = {
      id: 'job-a', workspaceId: 'workspace-a', connectionId: 'connection-a', bindingId: 'binding-a',
      deliveryId: 'delivery-a', fencingToken: 1, attemptCount: 0, maxAttempts: 5,
    };
    const envelope = encryptConnectorSecret(JSON.stringify(event), {
      workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'mailchimp',
      secretType: 'mailchimp.webhook', recordVersion: 1,
    }, resolver);
    const repo = repository();
    repo.claim = vi.fn(async () => [job]);
    repo.start = vi.fn(async ({ job: leased }) => ({ ...leased, attemptCount: 1 }));
    repo.readPayload = vi.fn(async () => ({ eventEnvelope: envelope, envelopeVersion: 1, audienceId: 'audience-a' }));
    repo.apply = vi.fn(async () => ({ outcome: 'applied' }));
    const result = await drainMailchimpWebhookJobs({
      repository: repo, workerId: 'worker-a', batchSize: 10, leaseSeconds: 90,
      deadlineMs: now.getTime() + 10_000, now: () => now, resolver,
    });
    expect(result).toEqual({ claimed: 1, succeeded: 1, deferred: 0, review: 0 });
    expect(repo.transition).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'succeeded' }));
  });

  it('fails wrong-audience plaintext closed into review', async () => {
    const event = { ...parseMailchimpMarketingWebhookForm(raw), audienceId: 'audience-b' };
    const job: MailchimpWebhookJob = {
      id: 'job-b', workspaceId: 'workspace-a', connectionId: 'connection-a', bindingId: 'binding-a',
      deliveryId: 'delivery-b', fencingToken: 2, attemptCount: 1, maxAttempts: 5,
    };
    const envelope = encryptConnectorSecret(JSON.stringify(event), {
      workspaceId: job.workspaceId, connectionId: job.connectionId, provider: 'mailchimp',
      secretType: 'mailchimp.webhook', recordVersion: 1,
    }, resolver);
    const repo = repository();
    repo.claim = vi.fn(async () => [job]);
    repo.start = vi.fn(async () => ({ ...job, attemptCount: 2 }));
    repo.readPayload = vi.fn(async () => ({ eventEnvelope: envelope, envelopeVersion: 1, audienceId: 'audience-a' }));
    const result = await drainMailchimpWebhookJobs({
      repository: repo, workerId: 'worker-a', batchSize: 10, leaseSeconds: 90,
      deadlineMs: now.getTime() + 10_000, now: () => now, resolver,
    });
    expect(result.review).toBe(1);
    expect(repo.apply).not.toHaveBeenCalled();
    expect(repo.transition).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'review', errorCategory: 'invalid_webhook_event' }));
  });
});
