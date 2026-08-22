import { describe, expect, it } from 'vitest';
import twilio from 'twilio';
import { verifyAndNormalizeTwilioWebhook } from './twilio-webhook-service';

const token = 'webhook-secret';

function signed(url: string, parameters: Record<string, string>) {
  return {
    rawBody: new URLSearchParams(parameters).toString(),
    signature: twilio.getExpectedTwilioSignature(token, url, parameters),
  };
}

describe('Twilio verified webhook normalization', () => {
  it('normalizes STOP as authoritative opt-out with bounded content only for the encrypted persistence boundary', () => {
    const url = 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/inbound';
    const parameters = {
      AccountSid: `AC${'a'.repeat(32)}`, MessageSid: `SM${'b'.repeat(32)}`,
      From: '+12025550123', To: '+12025550124', Body: 'STOP', OptOutType: 'STOP',
    };
    const result = verifyAndNormalizeTwilioWebhook({ kind: 'inbound', externalUrl: url, authToken: token, ...signed(url, parameters) });
    expect(result).toMatchObject({ optOutType: 'STOP', bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.body).toBe('STOP');
  });

  it('maps status callbacks and rejects a changed externally visible URL', () => {
    const url = 'https://crm.example.com/api/connectors/twilio/endpoint-key-1234/status';
    const parameters = {
      AccountSid: `AC${'a'.repeat(32)}`, MessageSid: `SM${'b'.repeat(32)}`,
      From: '+12025550124', To: '+12025550123', MessageStatus: 'delivered',
    };
    const proof = signed(url, parameters);
    expect(verifyAndNormalizeTwilioWebhook({ kind: 'status', externalUrl: url, authToken: token, ...proof }))
      .toMatchObject({ deliveryState: 'delivered' });
    expect(() => verifyAndNormalizeTwilioWebhook({
      kind: 'status', externalUrl: `${url}?changed=1`, authToken: token, ...proof,
    })).toThrow(/signature verification/);
  });
});
