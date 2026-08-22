import { describe, expect, it, vi } from 'vitest';
import { loadGoogleGmailPushConfiguration } from '../config/google-gmail-push';
import { ingestGoogleGmailPush } from './google-gmail-push-service';

const key = 'a'.repeat(43);
const externalUrl = `https://crm.example.com/api/connectors/google/gmail/push/${key}`;
const configuration = loadGoogleGmailPushConfiguration({
  GOOGLE_GMAIL_PUBSUB_TOPIC: 'projects/omnix-prod/topics/gmail-push',
  GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION: 'projects/omnix-prod/subscriptions/gmail-push',
  GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: 'gmail-push@omnix-prod.iam.gserviceaccount.com',
  GOOGLE_GMAIL_PUSH_ENDPOINT_KEY: key,
  GOOGLE_GMAIL_PUSH_EXTERNAL_URL: externalUrl,
  GOOGLE_GMAIL_PUSH_AUDIENCE: externalUrl,
});

describe('Google Gmail verified push ingress', () => {
  it('verifies OIDC binding and stores only hash-derived wake-up evidence', async () => {
    const register = vi.fn(async (input: Parameters<import('./google-gmail-push-service').GoogleGmailPushRepository['register']>[0]) => ({
      accepted: input.accountEmailHash.length === 64, noOp: false,
    }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      iss: 'https://accounts.google.com', aud: externalUrl,
      email: configuration.serviceAccountEmail, email_verified: true,
      exp: Math.floor(new Date('2026-08-12T12:30:00Z').getTime() / 1000),
    }), { status: 200 }));
    const data = Buffer.from(JSON.stringify({ emailAddress: 'Owner@Example.com', historyId: '123' })).toString('base64url');
    await expect(ingestGoogleGmailPush({
      authorization: 'Bearer signed.oidc.token',
      rawBody: Buffer.from(JSON.stringify({
        subscription: configuration.subscriptionName,
        message: { messageId: 'provider-message-1', publishTime: '2026-08-12T12:00:00Z', data },
      })),
      externalUrl, configuration, repository: { register }, fetcher,
      now: new Date('2026-08-12T12:00:05Z'),
    })).resolves.toEqual({ accepted: true, noOp: false });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      accountEmailHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      historyIdHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(JSON.stringify(register.mock.calls[0]?.[0])).not.toContain('owner@example.com');
    expect(JSON.stringify(register.mock.calls[0]?.[0])).not.toContain('provider-message-1');
  });

  it('rejects a valid-looking token bound to another audience', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      iss: 'https://accounts.google.com', aud: 'https://evil.example.com/push',
      email: configuration.serviceAccountEmail, email_verified: true,
      exp: Math.floor(new Date('2026-08-12T12:30:00Z').getTime() / 1000),
    }), { status: 200 }));
    await expect(ingestGoogleGmailPush({
      authorization: 'Bearer signed.oidc.token', rawBody: Buffer.from('{}'),
      externalUrl, configuration, repository: { register: vi.fn() }, fetcher,
      now: new Date('2026-08-12T12:00:05Z'),
    })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
