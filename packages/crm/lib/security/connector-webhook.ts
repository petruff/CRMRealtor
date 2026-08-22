import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConnectorError, sha256Hex, type ConnectorProvider } from '../domain/connector.ts';

export interface VerifiedConnectorWebhook {
  readonly provider: Exclude<ConnectorProvider, 'contract-test'>;
  readonly bodyHash: string;
  readonly providerEventKeyHash: string;
  readonly receivedAt: string;
  readonly replayKey: string;
}

export interface ConnectorWebhookReplayStore {
  claim(replayKey: string, expiresAt: string): Promise<boolean>;
}

export function createMemoryWebhookReplayStore(): ConnectorWebhookReplayStore {
  const claims = new Map<string, string>();
  return {
    async claim(replayKey, expiresAt) {
      const current = claims.get(replayKey);
      if (current) return false;
      claims.set(replayKey, expiresAt);
      return true;
    },
  };
}

export async function verifyHmacConnectorWebhook(input: {
  readonly provider: Exclude<ConnectorProvider, 'contract-test'>;
  readonly rawBody: Uint8Array;
  readonly signature: string;
  readonly signingSecret: string;
  readonly providerEventKey: string;
  readonly signedTimestamp: number;
  readonly now: Date;
  readonly toleranceSeconds?: number;
  readonly replayStore: ConnectorWebhookReplayStore;
}): Promise<VerifiedConnectorWebhook> {
  const tolerance = input.toleranceSeconds ?? 300;
  if (input.rawBody.byteLength > 1_048_576 || input.rawBody.byteLength === 0) {
    throw new ConnectorError('invalid-input', 'Connector webhook body size is invalid.');
  }
  if (!input.signingSecret || input.signingSecret.length > 4_096) {
    throw new ConnectorError('configuration-required', 'Connector webhook signing secret is invalid.');
  }
  if (!Number.isFinite(input.now.getTime()) || !Number.isInteger(input.signedTimestamp)
    || Math.abs(Math.floor(input.now.getTime() / 1_000) - input.signedTimestamp) > tolerance) {
    throw new ConnectorError('forbidden', 'Connector webhook timestamp is outside the replay window.');
  }
  const signed = Buffer.concat([
    Buffer.from(`${input.signedTimestamp}.`, 'utf8'),
    Buffer.from(input.rawBody),
  ]);
  const expected = createHmac('sha256', input.signingSecret).update(signed).digest();
  const receivedHex = input.signature.replace(/^sha256=/i, '');
  const received = /^[a-f0-9]{64}$/i.test(receivedHex) ? Buffer.from(receivedHex, 'hex') : Buffer.alloc(0);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ConnectorError('forbidden', 'Connector webhook signature verification failed.');
  }
  const bodyHash = sha256Hex(input.rawBody);
  const providerEventKeyHash = sha256Hex(input.providerEventKey);
  const replayKey = sha256Hex(`${input.provider}|${providerEventKeyHash}|${bodyHash}`);
  const expiresAt = new Date(input.now.getTime() + tolerance * 2 * 1_000).toISOString();
  if (!await input.replayStore.claim(replayKey, expiresAt)) {
    throw new ConnectorError('conflict', 'Connector webhook delivery was already claimed.');
  }
  return {
    provider: input.provider,
    bodyHash,
    providerEventKeyHash,
    receivedAt: input.now.toISOString(),
    replayKey,
  };
}

/** Parses and verifies Mailchimp Marketing's `t=<unix>,v1=<hex>` header. */
export async function verifyMailchimpMarketingWebhook(input: {
  readonly rawBody: Uint8Array;
  readonly signatureHeader: string;
  readonly signingSecret: string;
  readonly providerEventKey: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
  readonly replayStore: ConnectorWebhookReplayStore;
}): Promise<VerifiedConnectorWebhook> {
  const fields = new Map(input.signatureHeader.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator > 0
      ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
      : ['', ''];
  }));
  const timestampText = fields.get('t');
  const signature = fields.get('v1');
  if (!timestampText || !/^\d{10,13}$/.test(timestampText) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw new ConnectorError('forbidden', 'Mailchimp webhook signature header is invalid.');
  }
  return verifyHmacConnectorWebhook({
    provider: 'mailchimp',
    rawBody: input.rawBody,
    signature,
    signingSecret: input.signingSecret,
    providerEventKey: input.providerEventKey,
    signedTimestamp: Number(timestampText),
    now: input.now,
    toleranceSeconds: input.toleranceSeconds,
    replayStore: input.replayStore,
  });
}
