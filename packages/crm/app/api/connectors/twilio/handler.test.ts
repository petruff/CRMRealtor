import { describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { handleTwilioWebhook } from './handler';

const authToken = 'webhook-secret';
const externalBaseUrl = 'https://crm.example.com';

function request(kind: 'inbound' | 'status', parameters: Record<string, string>, signed = true) {
  const url = `${externalBaseUrl}/api/connectors/twilio/endpoint-key-1234/${kind}`;
  const body = new URLSearchParams(parameters).toString();
  const signature = twilio.getExpectedTwilioSignature(authToken, url, parameters);
  return new Request(url, {
    method: 'POST', body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed ? signature : 'forged',
    },
  });
}

describe('Twilio callback route boundary', () => {
  it('verifies then persists an inbound STOP event without returning content', async () => {
    const ingest = vi.fn(async () => ({ accepted: true, duplicate: false, outcome: 'opted-out' }));
    const resolveVerification = vi.fn(async () => ({
      workspaceId: 'workspace-a', connectionId: 'connection-a', authToken,
      accountSidHash: 'unused-by-handler', senderKeyHash: 'unused-by-handler', exactExternalUrlHash: 'unused-by-handler',
    }));
    const response = await handleTwilioWebhook(request('inbound', {
      AccountSid: `AC${'a'.repeat(32)}`, MessageSid: `SM${'b'.repeat(32)}`,
      From: '+12025550123', To: '+12025550124', Body: 'STOP', OptOutType: 'STOP',
    }), 'inbound', { repository: { ingest, resolveVerification }, externalBaseUrl, endpointKey: 'endpoint-key-1234',
      now: () => new Date('2026-08-12T12:00:00Z') });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, outcome: 'opted-out' });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ optOutType: 'STOP' }) }));
  });

  it('rejects a forged callback before persistence', async () => {
    const ingest = vi.fn();
    const resolveVerification = vi.fn(async () => ({
      workspaceId: 'workspace-a', connectionId: 'connection-a', authToken,
      accountSidHash: 'unused-by-handler', senderKeyHash: 'unused-by-handler', exactExternalUrlHash: 'unused-by-handler',
    }));
    const response = await handleTwilioWebhook(request('status', {
      AccountSid: `AC${'a'.repeat(32)}`, MessageSid: `SM${'b'.repeat(32)}`,
      From: '+12025550124', To: '+12025550123', MessageStatus: 'delivered',
    }, false), 'status', { repository: { ingest, resolveVerification }, externalBaseUrl, endpointKey: 'endpoint-key-1234' });
    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });
});
