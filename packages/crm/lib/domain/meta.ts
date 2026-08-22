import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConnectorError, sha256Hex, stablePayloadHash } from './connector.ts';

export const META_CHANNELS = ['facebook-page', 'instagram-business'] as const;
export type MetaChannel = (typeof META_CHANNELS)[number];

export const META_FACEBOOK_PAGE_PERMISSIONS = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
] as const;

export const META_INSTAGRAM_BUSINESS_PERMISSIONS = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
] as const;

export interface MetaInboundMessage {
  readonly channel: 'facebook' | 'instagram';
  readonly assetId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly messageId: string;
  readonly providerOccurredAt: string;
  readonly text?: string;
  readonly attachmentTypes: readonly string[];
  readonly eventKeyHash: string;
  readonly contentHash: string;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

export function metaPermissionsForChannels(channels: readonly MetaChannel[]): readonly string[] {
  if (!channels.length || channels.some((channel) => !META_CHANNELS.includes(channel))) {
    throw new ConnectorError('invalid-input', 'At least one supported Meta business channel is required.');
  }
  return uniqueSorted(channels.flatMap((channel) => channel === 'facebook-page'
    ? META_FACEBOOK_PAGE_PERMISSIONS
    : META_INSTAGRAM_BUSINESS_PERMISSIONS));
}

function safeToken(value: string, name: string, max = 512): string {
  const clean = value.trim();
  if (!clean || clean.length > max || !/^[A-Za-z0-9._:-]+$/.test(clean)) {
    throw new ConnectorError('invalid-input', `Meta ${name} is invalid.`);
  }
  return clean;
}

export function verifyMetaWebhookChallenge(input: {
  readonly mode: string | null;
  readonly verifyToken: string | null;
  readonly challenge: string | null;
  readonly expectedVerifyToken: string;
}): string {
  if (input.mode !== 'subscribe' || !input.verifyToken || !input.expectedVerifyToken
    || input.verifyToken.length > 4_096 || input.expectedVerifyToken.length > 4_096) {
    throw new ConnectorError('forbidden', 'Meta webhook challenge verification failed.');
  }
  const received = Buffer.from(input.verifyToken, 'utf8');
  const expected = Buffer.from(input.expectedVerifyToken, 'utf8');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ConnectorError('forbidden', 'Meta webhook challenge verification failed.');
  }
  return safeToken(input.challenge ?? '', 'challenge', 1_024);
}

export function verifyMetaWebhookSignature(input: {
  readonly rawBody: Uint8Array;
  readonly signature: string;
  readonly appSecret: string;
}): string {
  if (!input.rawBody.byteLength || input.rawBody.byteLength > 1_048_576
    || !input.appSecret || input.appSecret.length > 4_096) {
    throw new ConnectorError('invalid-input', 'Meta webhook authority is invalid.');
  }
  const match = /^sha256=([A-Fa-f0-9]{64})$/.exec(input.signature.trim());
  const received = match ? Buffer.from(match[1]!, 'hex') : Buffer.alloc(0);
  const expected = createHmac('sha256', input.appSecret).update(input.rawBody).digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ConnectorError('forbidden', 'Meta webhook signature verification failed.');
  }
  return sha256Hex(input.rawBody);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 10_000 || /[\u0000\u007f]/.test(value)) {
    throw new ConnectorError('invalid-input', 'Meta message text is invalid.');
  }
  return value;
}

function providerTimestamp(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = new Date(numeric);
  if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isFinite(date.getTime())) {
    throw new ConnectorError('invalid-input', 'Meta event timestamp is invalid.');
  }
  return date.toISOString();
}

export function normalizeMetaInboundMessages(rawBody: Uint8Array): readonly MetaInboundMessage[] {
  if (!rawBody.byteLength || rawBody.byteLength > 1_048_576) {
    throw new ConnectorError('invalid-input', 'Meta webhook body size is invalid.');
  }
  let root: Record<string, unknown>;
  try {
    root = record(JSON.parse(Buffer.from(rawBody).toString('utf8'))) ?? {};
  } catch {
    throw new ConnectorError('invalid-input', 'Meta webhook JSON is invalid.');
  }
  const channel = root.object === 'page' ? 'facebook' : root.object === 'instagram' ? 'instagram' : undefined;
  if (!channel || !Array.isArray(root.entry) || root.entry.length > 100) {
    throw new ConnectorError('invalid-input', 'Meta webhook object or entries are invalid.');
  }
  const events: MetaInboundMessage[] = [];
  for (const rawEntry of root.entry) {
    const entry = record(rawEntry);
    if (!entry || !Array.isArray(entry.messaging) || entry.messaging.length > 100) {
      throw new ConnectorError('invalid-input', 'Meta webhook messaging entries are invalid.');
    }
    const assetId = safeToken(String(entry.id ?? ''), 'asset id');
    for (const rawMessaging of entry.messaging) {
      const messaging = record(rawMessaging);
      const message = record(messaging?.message);
      if (!messaging || !message || message.is_echo === true) continue;
      const senderId = safeToken(String(record(messaging.sender)?.id ?? ''), 'sender id');
      const recipientId = safeToken(String(record(messaging.recipient)?.id ?? ''), 'recipient id');
      const messageId = safeToken(String(message.mid ?? ''), 'message id');
      const text = boundedText(message.text);
      const rawAttachments = message.attachments;
      if (rawAttachments !== undefined && (!Array.isArray(rawAttachments) || rawAttachments.length > 20)) {
        throw new ConnectorError('invalid-input', 'Meta message attachments are invalid.');
      }
      const attachmentTypes = uniqueSorted((Array.isArray(rawAttachments) ? rawAttachments : []).map((item) => {
        const type = record(item)?.type;
        return safeToken(typeof type === 'string' ? type : '', 'attachment type', 64);
      }));
      if (!text && !attachmentTypes.length) continue;
      const occurredAt = providerTimestamp(messaging.timestamp);
      const eventIdentity = { channel, assetId, senderId, recipientId, messageId, occurredAt };
      events.push({
        channel, assetId, senderId, recipientId, messageId,
        providerOccurredAt: occurredAt,
        ...(text ? { text } : {}),
        attachmentTypes,
        eventKeyHash: stablePayloadHash(eventIdentity),
        contentHash: stablePayloadHash({ text, attachmentTypes }),
      });
      if (events.length > 500) throw new ConnectorError('invalid-input', 'Meta webhook contains too many messages.');
    }
  }
  return events;
}

export function verifyAndNormalizeMetaWebhook(input: {
  readonly rawBody: Uint8Array;
  readonly signature: string;
  readonly appSecret: string;
}): { readonly bodyHash: string; readonly messages: readonly MetaInboundMessage[] } {
  const bodyHash = verifyMetaWebhookSignature(input);
  return { bodyHash, messages: normalizeMetaInboundMessages(input.rawBody) };
}
