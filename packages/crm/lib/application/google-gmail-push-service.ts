import { randomUUID } from 'node:crypto';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type { GoogleGmailPushConfiguration } from '../config/google-gmail-push.ts';

const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';
const MAX_TOKEN_BYTES = 16_384;

export interface GoogleGmailPushRepository {
  register(input: {
    readonly endpointKeyHash: string;
    readonly exactExternalUrlHash: string;
    readonly subscriptionHash: string;
    readonly oidcAudienceHash: string;
    readonly pubsubMessageIdHash: string;
    readonly accountEmailHash: string;
    readonly historyIdHash: string;
    readonly publishedAt: string;
    readonly receivedAt: string;
    readonly correlationId: string;
  }): Promise<{ readonly accepted: boolean; readonly noOp: boolean }>;
}

interface VerifiedPushIdentity {
  readonly audience: string;
  readonly email: string;
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.ok || Buffer.byteLength(body, 'utf8') > 64_000) {
    throw new ConnectorError('forbidden', 'Google Pub/Sub identity verification failed.');
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch { throw new ConnectorError('forbidden', 'Google Pub/Sub identity response is invalid.'); }
}

export async function verifyGooglePubSubOidcToken(input: {
  readonly token: string;
  readonly configuration: GoogleGmailPushConfiguration;
  readonly fetcher?: typeof fetch;
  readonly now?: Date;
}): Promise<VerifiedPushIdentity> {
  if (!input.token || Buffer.byteLength(input.token, 'utf8') > MAX_TOKEN_BYTES
    || /[\u0000-\u0020\u007f]/.test(input.token)) {
    throw new ConnectorError('forbidden', 'Google Pub/Sub bearer token is invalid.');
  }
  const url = new URL(TOKENINFO_ENDPOINT);
  url.searchParams.set('id_token', input.token);
  const response = await (input.fetcher ?? fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
  const row = await boundedJson(response);
  const issuer = String(row.iss ?? '');
  const audience = String(row.aud ?? '');
  const email = String(row.email ?? '').trim().toLowerCase();
  const verified = row.email_verified === true || row.email_verified === 'true';
  const expiresAt = Number(row.exp) * 1_000;
  const now = (input.now ?? new Date()).getTime();
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(issuer)
    || audience !== input.configuration.audience || email !== input.configuration.serviceAccountEmail
    || !verified || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 3_700_000) {
    throw new ConnectorError('forbidden', 'Google Pub/Sub identity is not bound to this endpoint.');
  }
  return { audience, email };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('invalid-input', message);
  return value as Record<string, unknown>;
}

export async function ingestGoogleGmailPush(input: {
  readonly authorization: string;
  readonly rawBody: Uint8Array;
  readonly externalUrl: string;
  readonly configuration: GoogleGmailPushConfiguration;
  readonly repository: GoogleGmailPushRepository;
  readonly fetcher?: typeof fetch;
  readonly now?: Date;
}) {
  if (input.rawBody.byteLength < 2 || input.rawBody.byteLength > 256_000
    || input.externalUrl !== input.configuration.externalUrl) {
    throw new ConnectorError('invalid-input', 'Google Gmail push request is invalid.');
  }
  const bearer = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(input.authorization)?.[1];
  if (!bearer) throw new ConnectorError('forbidden', 'Google Pub/Sub bearer token is required.');
  await verifyGooglePubSubOidcToken({
    token: bearer, configuration: input.configuration,
    ...(input.fetcher ? { fetcher: input.fetcher } : {}), ...(input.now ? { now: input.now } : {}),
  });
  let envelope: Record<string, unknown>;
  try { envelope = record(JSON.parse(Buffer.from(input.rawBody).toString('utf8')), 'Google Pub/Sub envelope is invalid.'); }
  catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError('invalid-input', 'Google Pub/Sub envelope is invalid.');
  }
  const message = record(envelope.message, 'Google Pub/Sub message is invalid.');
  const subscription = String(envelope.subscription ?? '');
  const messageId = String(message.messageId ?? message.message_id ?? '');
  const publishedAt = String(message.publishTime ?? message.publish_time ?? '');
  const encoded = String(message.data ?? '');
  if (subscription !== input.configuration.subscriptionName
    || !/^[A-Za-z0-9._~-]{1,512}$/.test(messageId)
    || !Number.isFinite(new Date(publishedAt).getTime())
    || !/^[A-Za-z0-9_=-]{4,4096}$/.test(encoded)) {
    throw new ConnectorError('forbidden', 'Google Pub/Sub message binding failed.');
  }
  let data: Record<string, unknown>;
  try { data = record(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')), 'Google Gmail wake-up data is invalid.'); }
  catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError('invalid-input', 'Google Gmail wake-up data is invalid.');
  }
  const emailAddress = String(data.emailAddress ?? '').trim().toLowerCase();
  const historyId = String(data.historyId ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress) || !/^\d+$/.test(historyId)) {
    throw new ConnectorError('invalid-input', 'Google Gmail wake-up fields are invalid.');
  }
  const receivedAt = (input.now ?? new Date()).toISOString();
  return input.repository.register({
    endpointKeyHash: input.configuration.endpointKeyHash,
    exactExternalUrlHash: input.configuration.exactExternalUrlHash,
    subscriptionHash: input.configuration.subscriptionHash,
    oidcAudienceHash: input.configuration.oidcAudienceHash,
    pubsubMessageIdHash: sha256Hex(messageId), accountEmailHash: sha256Hex(emailAddress),
    historyIdHash: sha256Hex(historyId), publishedAt: new Date(publishedAt).toISOString(),
    receivedAt, correlationId: randomUUID(),
  });
}
