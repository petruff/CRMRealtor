import { describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { TwilioMessagingClient, loadTwilioConfiguration, validateTwilioWebhook } from './twilio-client';

const configuration = {
  accountSid: `AC${'a'.repeat(32)}`,
  apiKeySid: `SK${'b'.repeat(32)}`,
  apiKeySecret: 'secret',
  messagingServiceSid: `MG${'c'.repeat(32)}`,
  webhookAuthToken: 'webhook-secret',
  callbackBaseUrl: 'https://crm.example.com',
  callbackEndpointKey: 'endpoint-key-1234',
};

describe('Twilio provider boundary', () => {
  it('fails closed unless every server-only credential and fixed callback base exists', () => {
    expect(() => loadTwilioConfiguration({})).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(loadTwilioConfiguration({
      TWILIO_ACCOUNT_SID: configuration.accountSid,
      TWILIO_API_KEY_SID: configuration.apiKeySid,
      TWILIO_API_KEY_SECRET: configuration.apiKeySecret,
      TWILIO_MESSAGING_SERVICE_SID: configuration.messagingServiceSid,
      TWILIO_WEBHOOK_AUTH_TOKEN: configuration.webhookAuthToken,
      TWILIO_CALLBACK_BASE_URL: configuration.callbackBaseUrl,
      TWILIO_CALLBACK_ENDPOINT_KEY: configuration.callbackEndpointKey,
    })).toEqual(configuration);
  });

  it('sends through the configured Messaging Service without treating a local key as provider idempotency', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return new Response(JSON.stringify({
      sid: `SM${'d'.repeat(32)}`, status: 'accepted',
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const client = new TwilioMessagingClient(configuration, fetcher as typeof fetch);
    await expect(client.sendMessage({ to: '+12025550123', body: 'Tour confirmed.', idempotencyKey: 'message-1' }))
      .resolves.toEqual({ messageSid: `SM${'d'.repeat(32)}`, status: 'accepted' });
    const init = calls[0]?.init;
    expect(init).toBeDefined();
    expect(String(init?.body)).toContain(`MessagingServiceSid=MG${'c'.repeat(32)}`);
    expect(String(init?.body)).toContain('StatusCallback=https%3A%2F%2Fcrm.example.com%2Fapi%2Fconnectors%2Ftwilio%2Fendpoint-key-1234%2Fstatus');
    expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false);
  });

  it('probes the exact configured Messaging Service identity', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('api.twilio.com')) {
        return new Response(JSON.stringify({ sid: configuration.accountSid, status: 'active' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        sid: configuration.messagingServiceSid,
        account_sid: configuration.accountSid,
      }), { status: 200 });
    });
    const client = new TwilioMessagingClient(configuration, fetcher as typeof fetch);
    await expect(client.probeMessagingService()).resolves.toEqual({
      accountSid: configuration.accountSid,
      serviceSid: configuration.messagingServiceSid,
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      `https://messaging.twilio.com/v1/Services/${configuration.messagingServiceSid}`,
    );
  });

  it('configures distinct service-level inbound and status callback routes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return new Response(JSON.stringify({
      sid: configuration.messagingServiceSid,
      account_sid: configuration.accountSid,
      inbound_request_url: 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/inbound',
      status_callback: 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/status',
      use_inbound_webhook_on_number: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new TwilioMessagingClient(configuration, fetcher as typeof fetch);
    await expect(client.configureMessagingServiceCallbacks({
      inboundUrl: 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/inbound',
      statusUrl: 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/status',
    })).resolves.toEqual({
      inboundUrl: 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/inbound',
      statusUrl: 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/status',
    });
    expect(calls[0]?.url).toBe(
      `https://messaging.twilio.com/v1/Services/${configuration.messagingServiceSid}`,
    );
    expect(String(calls[0]?.init?.body)).toContain('UseInboundWebhookOnNumber=false');
  });

  it('uses the official Twilio SDK against the exact externally visible URL and evolving parameters', () => {
    const url = 'https://crm.example.com/api/connectors/twilio/inbound';
    const parameters = { From: '+12025550123', To: '+12025550124', Body: 'STOP', OptOutType: 'STOP' };
    const signature = twilio.getExpectedTwilioSignature(configuration.webhookAuthToken, url, parameters);
    expect(validateTwilioWebhook({ authToken: configuration.webhookAuthToken, signature, externalUrl: url, parameters })).toBe(true);
    expect(validateTwilioWebhook({ authToken: configuration.webhookAuthToken, signature, externalUrl: `${url}?changed=true`, parameters })).toBe(false);
  });

  it('recovers exactly one recent approved outbound message and fails closed on ambiguity', async () => {
    const row = {
      sid: `SM${'e'.repeat(32)}`, status: 'sent', to: '+12025550123', body: 'Tour confirmed.',
      direction: 'outbound-api', messaging_service_sid: configuration.messagingServiceSid,
      date_created: 'Tue, 12 Aug 2026 16:00:10 +0000',
    };
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ messages: [row] }), { status: 200 });
    });
    const client = new TwilioMessagingClient(configuration, fetcher as typeof fetch);
    await expect(client.findApprovedMessage({
      to: '+12025550123', body: 'Tour confirmed.', attemptedAt: '2026-08-12T16:00:00Z',
    })).resolves.toEqual({ messageSid: row.sid, status: 'sent' });
    expect(calls[0]).toContain('To=%2B12025550123');
    expect(calls[0]).toContain('PageSize=100');

    const ambiguous = new TwilioMessagingClient(configuration, vi.fn(async () => new Response(JSON.stringify({
      messages: [row, { ...row, sid: `SM${'f'.repeat(32)}` }],
    }), { status: 200 })) as typeof fetch);
    await expect(ambiguous.findApprovedMessage({
      to: '+12025550123', body: 'Tour confirmed.', attemptedAt: '2026-08-12T16:00:00Z',
    })).resolves.toBeUndefined();
  });
});
