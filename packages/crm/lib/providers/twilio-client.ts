import twilio from 'twilio';
import { ConnectorError } from '../domain/connector.ts';
import { parseE164Phone, twilioStatusToDeliveryState, type TextingDeliveryState } from '../domain/texting.ts';

const TWILIO_API_HOST = 'api.twilio.com';
const TWILIO_MESSAGING_HOST = 'messaging.twilio.com';
const MAX_RESPONSE_BYTES = 1_048_576;

export type TwilioFetch = typeof fetch;

export interface TwilioConfiguration {
  readonly accountSid: string;
  readonly apiKeySid: string;
  readonly apiKeySecret: string;
  readonly messagingServiceSid: string;
  readonly webhookAuthToken?: string;
  readonly callbackBaseUrl: string;
  readonly callbackEndpointKey: string;
}

export interface TwilioMessageResult {
  readonly messageSid: string;
  readonly status: TextingDeliveryState;
}

export interface TwilioApprovedMessageLookup {
  readonly to: string;
  readonly body: string;
  readonly attemptedAt: string;
}

function configured(value: string | undefined, name: string, pattern?: RegExp): string {
  const clean = value?.trim() ?? '';
  if (!clean || clean.length > 4_096 || /[\u0000-\u001f\u007f]/.test(clean) || (pattern && !pattern.test(clean))) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return clean;
}

function fixedCallbackBase(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorError('configuration-required', 'TWILIO_CALLBACK_BASE_URL is invalid.'); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new ConnectorError('configuration-required', 'TWILIO_CALLBACK_BASE_URL must be HTTPS or loopback HTTP.');
  }
  return url.toString().replace(/\/$/, '');
}

export function loadTwilioConfiguration(
  environment: Record<string, string | undefined> = process.env,
): TwilioConfiguration {
  return {
    accountSid: configured(environment.TWILIO_ACCOUNT_SID, 'TWILIO_ACCOUNT_SID', /^AC[A-Fa-f0-9]{32}$/),
    apiKeySid: configured(environment.TWILIO_API_KEY_SID, 'TWILIO_API_KEY_SID', /^SK[A-Fa-f0-9]{32}$/),
    apiKeySecret: configured(environment.TWILIO_API_KEY_SECRET, 'TWILIO_API_KEY_SECRET'),
    messagingServiceSid: configured(
      environment.TWILIO_MESSAGING_SERVICE_SID,
      'TWILIO_MESSAGING_SERVICE_SID',
      /^MG[A-Fa-f0-9]{32}$/,
    ),
    webhookAuthToken: environment.TWILIO_WEBHOOK_AUTH_TOKEN?.trim()
      ? configured(environment.TWILIO_WEBHOOK_AUTH_TOKEN, 'TWILIO_WEBHOOK_AUTH_TOKEN')
      : undefined,
    callbackBaseUrl: fixedCallbackBase(configured(environment.TWILIO_CALLBACK_BASE_URL, 'TWILIO_CALLBACK_BASE_URL')),
    callbackEndpointKey: configured(
      environment.TWILIO_CALLBACK_ENDPOINT_KEY,
      'TWILIO_CALLBACK_ENDPOINT_KEY',
      /^[A-Za-z0-9_-]{16,256}$/,
    ),
  };
}

function basicAuth(configuration: TwilioConfiguration): string {
  return `Basic ${Buffer.from(`${configuration.apiKeySid}:${configuration.apiKeySecret}`).toString('base64')}`;
}

async function boundedJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new ConnectorError('provider-disabled', `${operation} returned an oversized response.`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new ConnectorError('provider-disabled', `${operation} returned an oversized response.`);
  }
  let parsed: Record<string, unknown> = {};
  try {
    const value = body ? JSON.parse(body) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    parsed = value as Record<string, unknown>;
  } catch {
    throw new ConnectorError('provider-disabled', `${operation} returned invalid JSON.`);
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) {
      throw new ConnectorError('provider-retryable', `${operation} is temporarily unavailable.`);
    }
    if ([401, 403].includes(response.status)) throw new ConnectorError('forbidden', `${operation} was refused.`);
    throw new ConnectorError('provider-disabled', `${operation} failed safely.`);
  }
  return parsed;
}

export class TwilioMessagingClient {
  private readonly configuration: TwilioConfiguration;
  private readonly fetcher: TwilioFetch;

  constructor(configuration: TwilioConfiguration, fetcher: TwilioFetch = fetch) {
    this.configuration = configuration;
    this.fetcher = fetcher;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    host: typeof TWILIO_API_HOST | typeof TWILIO_MESSAGING_HOST = TWILIO_API_HOST,
  ): Promise<Record<string, unknown>> {
    if (!path.startsWith('/') || path.includes('..') || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new ConnectorError('invalid-input', 'Twilio API path is invalid.');
    }
    const url = new URL(`https://${host}${path}`);
    if (url.hostname !== host || url.protocol !== 'https:') {
      throw new ConnectorError('invalid-input', 'Twilio API endpoint is invalid.');
    }
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('authorization', basicAuth(this.configuration));
    if (init.body) headers.set('content-type', 'application/x-www-form-urlencoded');
    return boundedJson(await this.fetcher(url.toString(), {
      ...init,
      headers,
      redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10_000),
    }), 'Twilio Messaging API');
  }

  async probeMessagingService(): Promise<{ readonly accountSid: string; readonly serviceSid: string }> {
    const payload = await this.request(
      `/2010-04-01/Accounts/${this.configuration.accountSid}.json`,
    );
    if (payload.sid !== this.configuration.accountSid || !['active', 'suspended'].includes(String(payload.status))) {
      throw new ConnectorError('provider-disabled', 'Twilio account identity is invalid or inactive.');
    }
    const service = await this.request(
      `/v1/Services/${this.configuration.messagingServiceSid}`,
      {},
      TWILIO_MESSAGING_HOST,
    );
    if (service.sid !== this.configuration.messagingServiceSid
      || service.account_sid !== this.configuration.accountSid) {
      throw new ConnectorError('provider-disabled', 'Twilio Messaging Service identity is invalid.');
    }
    return { accountSid: this.configuration.accountSid, serviceSid: this.configuration.messagingServiceSid };
  }

  async configureMessagingServiceCallbacks(input: {
    readonly inboundUrl: string;
    readonly statusUrl: string;
  }): Promise<{ readonly inboundUrl: string; readonly statusUrl: string }> {
    const inboundUrl = fixedCallbackBase(input.inboundUrl);
    const statusUrl = fixedCallbackBase(input.statusUrl);
    if (inboundUrl === statusUrl) {
      throw new ConnectorError('invalid-input', 'Twilio inbound and status callback URLs must be distinct.');
    }
    const service = await this.request(
      `/v1/Services/${this.configuration.messagingServiceSid}`,
      {
        method: 'POST',
        body: new URLSearchParams({
          InboundRequestUrl: inboundUrl,
          InboundMethod: 'POST',
          StatusCallback: statusUrl,
          UseInboundWebhookOnNumber: 'false',
        }),
      },
      TWILIO_MESSAGING_HOST,
    );
    if (service.sid !== this.configuration.messagingServiceSid
      || service.account_sid !== this.configuration.accountSid
      || service.inbound_request_url !== inboundUrl
      || service.status_callback !== statusUrl
      || service.use_inbound_webhook_on_number !== false) {
      throw new ConnectorError('provider-disabled', 'Twilio did not persist the exact Omnix callback routes.');
    }
    return { inboundUrl, statusUrl };
  }

  async sendMessage(input: {
    readonly to: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<TwilioMessageResult> {
    const to = parseE164Phone(input.to);
    if (!input.body || input.body.length > 1_600 || /[\u0000\u007f]/.test(input.body)
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) {
      throw new ConnectorError('invalid-input', 'Twilio send payload is invalid.');
    }
    const statusCallback = `${this.configuration.callbackBaseUrl}/api/connectors/twilio/${this.configuration.callbackEndpointKey}/status`;
    const payload = await this.request(`/2010-04-01/Accounts/${this.configuration.accountSid}/Messages.json`, {
      method: 'POST',
      body: new URLSearchParams({
        To: to,
        Body: input.body,
        MessagingServiceSid: this.configuration.messagingServiceSid,
        StatusCallback: statusCallback,
      }),
    });
    if (typeof payload.sid !== 'string' || !/^SM[A-Fa-f0-9]{32}$/.test(payload.sid)) {
      throw new ConnectorError('provider-disabled', 'Twilio send response is invalid.');
    }
    return { messageSid: payload.sid, status: twilioStatusToDeliveryState(payload.status ?? 'accepted') };
  }

  async getMessage(messageSid: string): Promise<TwilioMessageResult | undefined> {
    if (!/^SM[A-Fa-f0-9]{32}$/.test(messageSid)) throw new ConnectorError('invalid-input', 'Twilio Message SID is invalid.');
    const response = await this.fetcher(
      `https://${TWILIO_API_HOST}/2010-04-01/Accounts/${this.configuration.accountSid}/Messages/${messageSid}.json`,
      { headers: { accept: 'application/json', authorization: basicAuth(this.configuration) }, redirect: 'error', signal: AbortSignal.timeout(10_000) },
    );
    if (response.status === 404) return undefined;
    const payload = await boundedJson(response, 'Twilio message lookup');
    return { messageSid, status: twilioStatusToDeliveryState(payload.status) };
  }

  /**
   * Recover a Message SID after Twilio accepted a send but the HTTP response was
   * lost. Twilio's classic Messages API has no provider-side idempotency key, so
   * this lookup deliberately succeeds only for one exact, recent, outbound
   * match. Zero or multiple matches remain unknown and are never resent.
   */
  async findApprovedMessage(input: TwilioApprovedMessageLookup): Promise<TwilioMessageResult | undefined> {
    const to = parseE164Phone(input.to);
    if (!input.body || input.body.length > 1_600 || /[\u0000\u007f]/.test(input.body)) {
      throw new ConnectorError('invalid-input', 'Twilio recovery payload is invalid.');
    }
    const attemptedAt = new Date(input.attemptedAt);
    if (!Number.isFinite(attemptedAt.getTime())) {
      throw new ConnectorError('invalid-input', 'Twilio recovery timestamp is invalid.');
    }
    const query = new URLSearchParams({
      To: to,
      'DateSent>': attemptedAt.toISOString().slice(0, 10),
      PageSize: '100',
    });
    const payload = await this.request(
      `/2010-04-01/Accounts/${this.configuration.accountSid}/Messages.json?${query.toString()}`,
    );
    const rows = Array.isArray(payload.messages) ? payload.messages : [];
    const earliest = attemptedAt.getTime() - 120_000;
    const latest = attemptedAt.getTime() + 15 * 60_000;
    const matches = rows.flatMap((value): TwilioMessageResult[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const row = value as Record<string, unknown>;
      const createdAt = new Date(String(row.date_created ?? row.date_sent ?? '')).getTime();
      if (typeof row.sid !== 'string' || !/^SM[A-Fa-f0-9]{32}$/.test(row.sid)
        || row.to !== to || row.body !== input.body || row.direction !== 'outbound-api'
        || row.messaging_service_sid !== this.configuration.messagingServiceSid
        || !Number.isFinite(createdAt) || createdAt < earliest || createdAt > latest) return [];
      return [{ messageSid: row.sid, status: twilioStatusToDeliveryState(row.status) }];
    });
    return matches.length === 1 ? matches[0] : undefined;
  }
}

export function validateTwilioWebhook(input: {
  readonly authToken: string;
  readonly signature: string;
  readonly externalUrl: string;
  readonly parameters: Readonly<Record<string, string>>;
}): boolean {
  if (!input.authToken || input.authToken.length > 4_096
    || !input.signature || input.signature.length > 1_024) return false;
  let url: URL;
  try { url = new URL(input.externalUrl); } catch { return false; }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) return false;
  return twilio.validateRequest(input.authToken, input.signature, url.toString(), { ...input.parameters });
}
