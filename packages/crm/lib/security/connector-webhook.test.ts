import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createMemoryWebhookReplayStore,
  verifyHmacConnectorWebhook,
  verifyMailchimpMarketingWebhook,
} from './connector-webhook';

function signature(timestamp: number, body: Uint8Array, secret: string): string {
  return `sha256=${createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(body)]))
    .digest('hex')}`;
}

describe('connector webhook verification', () => {
  it('verifies the untouched raw body and rejects replay without retaining content', async () => {
    const rawBody = Buffer.from('{"event":"unsubscribe","email":"private@example.com"}');
    const signedTimestamp = 1_786_446_000;
    const replayStore = createMemoryWebhookReplayStore();
    const input = {
      provider: 'mailchimp' as const,
      rawBody,
      signature: signature(signedTimestamp, rawBody, 'webhook-secret'),
      signingSecret: 'webhook-secret',
      providerEventKey: 'event-123',
      signedTimestamp,
      now: new Date(signedTimestamp * 1_000),
      replayStore,
    };
    const verified = await verifyHmacConnectorWebhook(input);
    expect(verified).toMatchObject({ provider: 'mailchimp' });
    expect(JSON.stringify(verified)).not.toContain('private@example.com');
    await expect(verifyHmacConnectorWebhook(input)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects modified signatures and stale deliveries', async () => {
    const rawBody = Buffer.from('{}');
    const replayStore = createMemoryWebhookReplayStore();
    await expect(verifyHmacConnectorWebhook({
      provider: 'meta', rawBody, signature: 'sha256=00', signingSecret: 'secret',
      providerEventKey: 'event-1', signedTimestamp: 100, now: new Date(100_000), replayStore,
    })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(verifyHmacConnectorWebhook({
      provider: 'meta', rawBody, signature: signature(100, rawBody, 'secret'), signingSecret: 'secret',
      providerEventKey: 'event-2', signedTimestamp: 100, now: new Date(1_000_000), replayStore,
    })).rejects.toThrow(/replay window/i);
  });

  it('parses Mailchimp Marketing t/v1 signatures and verifies the raw body', async () => {
    const rawBody = Buffer.from('{"type":"unsubscribe","data":{"list_id":"audience-a"}}');
    const timestamp = 1_786_446_000;
    const secret = 'mailchimp-signing-secret';
    const hex = signature(timestamp, rawBody, secret).replace('sha256=', '');
    const replayStore = createMemoryWebhookReplayStore();
    await expect(verifyMailchimpMarketingWebhook({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${hex}`,
      signingSecret: secret,
      providerEventKey: 'event-a',
      now: new Date(timestamp * 1_000),
      replayStore,
    })).resolves.toMatchObject({ provider: 'mailchimp' });
    await expect(verifyMailchimpMarketingWebhook({
      rawBody: Buffer.from(`${rawBody.toString()} `),
      signatureHeader: `t=${timestamp},v1=${hex}`,
      signingSecret: secret,
      providerEventKey: 'event-b',
      now: new Date(timestamp * 1_000),
      replayStore,
    })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
