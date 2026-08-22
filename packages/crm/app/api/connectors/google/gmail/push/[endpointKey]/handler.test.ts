import { describe, expect, it, vi } from 'vitest';
import { loadGoogleGmailPushConfiguration } from '@/lib/config/google-gmail-push';
import { handleGoogleGmailPush } from './handler';

const key = 'a'.repeat(43);
const url = `https://crm.example.com/api/connectors/google/gmail/push/${key}`;
const configuration = loadGoogleGmailPushConfiguration({
  GOOGLE_GMAIL_PUBSUB_TOPIC: 'projects/omnix-prod/topics/gmail-push',
  GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION: 'projects/omnix-prod/subscriptions/gmail-push',
  GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: 'gmail-push@omnix-prod.iam.gserviceaccount.com',
  GOOGLE_GMAIL_PUSH_ENDPOINT_KEY: key, GOOGLE_GMAIL_PUSH_EXTERNAL_URL: url,
  GOOGLE_GMAIL_PUSH_AUDIENCE: url,
});

describe('Google Gmail push route', () => {
  it('acks only after verified durable registration', async () => {
    const register = vi.fn(async () => ({ accepted: true, noOp: false }));
    const data = Buffer.from(JSON.stringify({ emailAddress: 'owner@example.com', historyId: '120' })).toString('base64url');
    const response = await handleGoogleGmailPush(new Request(url, {
      method: 'POST', headers: { authorization: 'Bearer signed.oidc.token', 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: configuration.subscriptionName,
        message: { messageId: 'message-1', publishTime: '2026-08-12T12:00:00Z', data } }),
    }), {
      endpointKey: key, configuration, repository: { register }, now: new Date('2026-08-12T12:00:05Z'),
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        iss: 'https://accounts.google.com', aud: url, email: configuration.serviceAccountEmail,
        email_verified: true, exp: Math.floor(new Date('2026-08-12T12:30:00Z').getTime() / 1000),
      }), { status: 200 })),
    });
    expect(response.status).toBe(204);
    expect(register).toHaveBeenCalledOnce();
  });

  it('rejects an opaque endpoint mismatch before reading provider data', async () => {
    const response = await handleGoogleGmailPush(new Request(url, { method: 'POST', body: '{}' }), {
      endpointKey: 'b'.repeat(43), configuration, repository: { register: vi.fn() },
    });
    expect(response.status).toBe(404);
  });
});
