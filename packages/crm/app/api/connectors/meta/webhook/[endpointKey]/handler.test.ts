import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  handleMetaWebhookChallenge,
  handleMetaWebhookDelivery,
  type MetaWebhookHandlerRepository,
} from './handler';

const endpointKey = 'opaque-meta-endpoint-key-1234567890';
const authority = {
  workspaceId: 'workspace-a', connectionId: 'connection-a', graphVersion: 'v999.0',
  appSecret: 'app-secret', verifyToken: 'verify-secret', selectedAssetIds: ['page-123'],
};

function repository(): MetaWebhookHandlerRepository & { ingest: ReturnType<typeof vi.fn> } {
  return {
    resolveAuthority: vi.fn(async () => authority),
    confirmChallenge: vi.fn(async () => undefined),
    ingest: vi.fn(async () => ({ accepted: 1, duplicate: 0, review: 1 })),
  };
}

function signedRequest(body: Uint8Array, signature?: string): Request {
  return new Request(`https://crm.example.com/api/connectors/meta/webhook/${endpointKey}`, {
    method: 'POST', body: Buffer.from(body),
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature
      ?? `sha256=${createHmac('sha256', authority.appSecret).update(body).digest('hex')}` },
  });
}

describe('Meta webhook handler', () => {
  it('answers the GET challenge only after bound token verification', async () => {
    const repo = repository();
    const response = await handleMetaWebhookChallenge(new Request(
      `https://crm.example.com/api/connectors/meta/webhook/${endpointKey}?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=12345`,
    ), { repository: repo, endpointKey });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('12345');
    expect(repo.confirmChallenge).toHaveBeenCalledWith(expect.objectContaining({
      endpointKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      challengeEvidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    const denied = await handleMetaWebhookChallenge(new Request(
      `https://crm.example.com/api/connectors/meta/webhook/${endpointKey}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`,
    ), { repository: repo, endpointKey });
    expect(denied.status).toBe(403);
  });

  it('verifies raw-body HMAC and selected asset before durable ingestion', async () => {
    const repo = repository();
    const body = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: 'page-123', messaging: [{
      sender: { id: 'sender-1' }, recipient: { id: 'page-123' }, timestamp: 1_786_446_000_000,
      message: { mid: 'message-1', text: 'Can I book a showing?' },
    }] }] }));
    const response = await handleMetaWebhookDelivery(signedRequest(body), {
      repository: repo, endpointKey, now: () => new Date('2026-08-12T12:00:00.000Z'),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, accepted: 1, inboundOnly: true });
    expect(repo.ingest).toHaveBeenCalledWith(expect.objectContaining({
      endpointKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      messages: [expect.objectContaining({ assetId: 'page-123', channel: 'facebook' })],
    }));
    expect(JSON.stringify(repo.ingest.mock.calls[0]?.[0])).toContain('book a showing');
  });

  it('rejects forged signatures and payload-selected asset swaps before ingestion', async () => {
    const repo = repository();
    const wrongAsset = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: 'page-attacker', messaging: [{
      sender: { id: 'sender-1' }, recipient: { id: 'page-attacker' }, timestamp: 1_786_446_000_000,
      message: { mid: 'message-1', text: 'hello' },
    }] }] }));
    const forged = await handleMetaWebhookDelivery(signedRequest(wrongAsset, 'sha256=00'), { repository: repo, endpointKey });
    expect(forged.status).toBe(401);
    const swapped = await handleMetaWebhookDelivery(signedRequest(wrongAsset), { repository: repo, endpointKey });
    expect(swapped.status).toBe(401);
    expect(repo.ingest).not.toHaveBeenCalled();
  });
});
