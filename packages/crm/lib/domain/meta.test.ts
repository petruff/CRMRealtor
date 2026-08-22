import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  metaPermissionsForChannels,
  normalizeMetaInboundMessages,
  verifyAndNormalizeMetaWebhook,
  verifyMetaWebhookChallenge,
} from './meta';

describe('Meta business messaging domain', () => {
  it('uses only the minimal official inbound messaging permissions', () => {
    expect(metaPermissionsForChannels(['facebook-page'])).toEqual([
      'pages_manage_metadata', 'pages_messaging', 'pages_show_list',
    ]);
    expect(metaPermissionsForChannels(['instagram-business'])).toEqual([
      'instagram_business_basic', 'instagram_business_manage_messages',
    ]);
    expect(metaPermissionsForChannels(['facebook-page', 'instagram-business']))
      .not.toContain('pages_read_engagement');
  });

  it('verifies the challenge token in constant-time compatible form', () => {
    expect(verifyMetaWebhookChallenge({
      mode: 'subscribe', verifyToken: 'opaque-token', expectedVerifyToken: 'opaque-token', challenge: '123456',
    })).toBe('123456');
    expect(() => verifyMetaWebhookChallenge({
      mode: 'subscribe', verifyToken: 'wrong', expectedVerifyToken: 'opaque-token', challenge: '123456',
    })).toThrow(/verification failed/i);
  });

  it('verifies HMAC over the untouched body before minimizing message events', () => {
    const rawBody = Buffer.from(JSON.stringify({
      object: 'page',
      entry: [{ id: '123', messaging: [{
        sender: { id: '456' }, recipient: { id: '123' }, timestamp: 1_786_446_000_000,
        message: { mid: 'm_1', text: 'I would like a showing.' },
      }] }],
    }));
    const secret = 'app-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const verified = verifyAndNormalizeMetaWebhook({ rawBody, signature, appSecret: secret });
    expect(verified.messages).toEqual([expect.objectContaining({
      channel: 'facebook', assetId: '123', senderId: '456', messageId: 'm_1', text: 'I would like a showing.',
    })]);
    expect(JSON.stringify({ bodyHash: verified.bodyHash, eventKeyHash: verified.messages[0]?.eventKeyHash }))
      .not.toContain('showing');
    expect(() => verifyAndNormalizeMetaWebhook({
      rawBody: Buffer.from(`${rawBody.toString()} `), signature, appSecret: secret,
    })).toThrow(/signature/i);
  });

  it('skips echoes and retains attachment types without provider URLs', () => {
    const rawBody = Buffer.from(JSON.stringify({
      object: 'instagram', entry: [{ id: '987', messaging: [
        { sender: { id: '111' }, recipient: { id: '987' }, timestamp: 1_786_446_000_000,
          message: { mid: 'echo-1', text: 'sent by us', is_echo: true } },
        { sender: { id: '222' }, recipient: { id: '987' }, timestamp: 1_786_446_001_000,
          message: { mid: 'in-1', attachments: [{ type: 'image', payload: { url: 'https://private.example/photo' } }] } },
      ] }],
    }));
    const events = normalizeMetaInboundMessages(rawBody);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ channel: 'instagram', attachmentTypes: ['image'] });
    expect(JSON.stringify(events)).not.toContain('private.example');
  });
});
