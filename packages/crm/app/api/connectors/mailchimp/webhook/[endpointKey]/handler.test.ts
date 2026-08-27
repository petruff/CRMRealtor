import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseMailchimpWebhookRepository } from '@/lib/data/supabase-mailchimp-webhook-repository';
import { encryptConnectorSecret } from '@/lib/security/connector-secret-envelope';
import { handleMailchimpWebhookPost, handleMailchimpWebhookValidation } from './handler';

const now = new Date('2026-08-11T12:00:00.000Z');
const timestamp = Math.floor(now.getTime() / 1_000);
const raw = 'type=subscribe&fired_at=2026-08-11+12%3A00%3A00&data%5Bid%5D=member-a&data%5Blist_id%5D=audience-a&data%5Bemail%5D=ada%40example.com';
const secret = 'mailchimp-signing-secret';
const resolver = { activeVersion: 'v1', resolve: () => Buffer.alloc(32, 7) };

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
    claim: vi.fn(), start: vi.fn(), readPayload: vi.fn(), apply: vi.fn(), transition: vi.fn(),
  };
}

describe('Mailchimp webhook route handler', () => {
  it('accepts only the generated callback key shape during provider provisioning', async () => {
    const valid = await handleMailchimpWebhookValidation('a'.repeat(64));
    const malformed = await handleMailchimpWebhookValidation('a'.repeat(63));

    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe('ok');
    expect(malformed.status).toBe(404);
  });

  it('returns a bounded 202 receipt with no email or job identifier', async () => {
    const request = new Request('https://crm.example.com/webhook', {
      method: 'POST', headers: {
        'content-type': 'application/x-www-form-urlencoded',
      }, body: raw,
    });
    const exact = Buffer.from(await request.clone().arrayBuffer());
    const signature = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), exact])).digest('hex');
    request.headers.set('x-mailchimp-signature', `t=${timestamp},v1=${signature}`);
    const response = await handleMailchimpWebhookPost(
      request,
      'a'.repeat(48),
      { repository: repository(), now, resolver },
    );
    if (response.status !== 202) throw new Error(`unexpected response: ${response.status} ${await response.clone().text()}`);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ ok: true, schemaVersion: 'mailchimp-webhook-receipt.v1', accepted: true, duplicate: false });
    expect(JSON.stringify(body)).not.toMatch(/ada|workspace|job-a|signature/i);
  });

  it('rejects unsupported content types before repository access', async () => {
    const repo = repository();
    const response = await handleMailchimpWebhookPost(new Request('https://crm.example.com/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }), 'a'.repeat(48), { repository: repo, now, resolver });
    expect(response.status).toBe(415);
    expect(repo.readSigningAuthority).not.toHaveBeenCalled();
  });
});
