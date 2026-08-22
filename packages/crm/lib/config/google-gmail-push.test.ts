import { describe, expect, it } from 'vitest';
import { loadGoogleGmailPushConfiguration, loadOptionalGoogleGmailPushConfiguration } from './google-gmail-push';

const environment = {
  GOOGLE_GMAIL_PUBSUB_TOPIC: 'projects/omnix-prod/topics/gmail-push',
  GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION: 'projects/omnix-prod/subscriptions/gmail-push',
  GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: 'gmail-push@omnix-prod.iam.gserviceaccount.com',
  GOOGLE_GMAIL_PUSH_ENDPOINT_KEY: 'a'.repeat(43),
  GOOGLE_GMAIL_PUSH_EXTERNAL_URL: `https://crm.example.com/api/connectors/google/gmail/push/${'a'.repeat(43)}`,
  GOOGLE_GMAIL_PUSH_AUDIENCE: `https://crm.example.com/api/connectors/google/gmail/push/${'a'.repeat(43)}`,
};

describe('Google Gmail push configuration', () => {
  it('keeps the shared connector worker available when Gmail push is not configured', () => {
    expect(loadOptionalGoogleGmailPushConfiguration({})).toBeUndefined();
  });

  it('fails closed when Gmail push is only partially configured', () => {
    expect(() => loadOptionalGoogleGmailPushConfiguration({
      GOOGLE_GMAIL_PUBSUB_TOPIC: environment.GOOGLE_GMAIL_PUBSUB_TOPIC,
    })).toThrowError(/missing or invalid/);
  });
  it('binds one exact HTTPS endpoint, subscription and OIDC audience', () => {
    expect(loadGoogleGmailPushConfiguration(environment)).toMatchObject({
      serviceAccountEmail: environment.GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL,
      externalUrl: environment.GOOGLE_GMAIL_PUSH_EXTERNAL_URL,
      endpointKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('fails closed when audience drifts from the callback URL', () => {
    expect(() => loadGoogleGmailPushConfiguration({ ...environment, GOOGLE_GMAIL_PUSH_AUDIENCE: 'https://other.example.com/push' }))
      .toThrow(/same fixed HTTPS endpoint/i);
  });
});
