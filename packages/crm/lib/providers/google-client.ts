import { ConnectorError } from '../domain/connector.ts';
import {
  GOOGLE_BUNDLE_SCOPES,
  GOOGLE_IDENTITY_SCOPES,
  googleRequestedScopes,
  isGoogleScopeGranted,
  parseGoogleAccountIdentity,
  type GoogleAccountIdentity,
  type GoogleFeatureBundle,
  type GoogleGmailMetadataMessage,
} from '../domain/google-connector.ts';

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const MAX_RESPONSE_BYTES = 1_048_576;

export type GoogleFetch = typeof fetch;

export class GoogleCursorExpiredError extends ConnectorError {
  readonly stream: 'gmail-history' | 'calendar-events';

  constructor(stream: 'gmail-history' | 'calendar-events') {
    super('conflict', `Google ${stream} cursor expired and requires a bounded full resync.`);
    this.name = 'GoogleCursorExpiredError';
    this.stream = stream;
  }
}

export interface GoogleOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleOAuthExchange {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresInSeconds: number;
  readonly grantedScopes: readonly string[];
  readonly identity: GoogleAccountIdentity;
}

export interface GoogleAccessTokenRefresh {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly grantedScopes?: readonly string[];
}

function configured(value: string | undefined, name: string): string {
  const clean = value?.trim();
  if (!clean || clean.length > 4_096 || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return clean;
}

function fixedRedirect(value: string): string {
  let redirect: URL;
  try { redirect = new URL(value); } catch { throw new ConnectorError('configuration-required', 'GOOGLE_CONNECTOR_REDIRECT_URI is invalid.'); }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(redirect.hostname);
  if (redirect.username || redirect.password || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback))
    || redirect.pathname !== '/api/connectors/google/callback' || redirect.search || redirect.hash) {
    throw new ConnectorError('configuration-required', 'GOOGLE_CONNECTOR_REDIRECT_URI must use the fixed Omnix callback path.');
  }
  return redirect.toString();
}

export function loadGoogleOAuthConfiguration(
  environment: Record<string, string | undefined> = process.env,
): GoogleOAuthConfiguration {
  return {
    clientId: configured(environment.GOOGLE_CONNECTOR_CLIENT_ID, 'GOOGLE_CONNECTOR_CLIENT_ID'),
    clientSecret: configured(environment.GOOGLE_CONNECTOR_CLIENT_SECRET, 'GOOGLE_CONNECTOR_CLIENT_SECRET'),
    redirectUri: fixedRedirect(configured(environment.GOOGLE_CONNECTOR_REDIRECT_URI, 'GOOGLE_CONNECTOR_REDIRECT_URI')),
  };
}

export function createGoogleAuthorizationUrl(input: {
  readonly configuration: GoogleOAuthConfiguration;
  readonly state: string;
  readonly codeChallenge: string;
  readonly bundle: GoogleFeatureBundle;
}): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state) || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    throw new ConnectorError('invalid-input', 'Google OAuth state or PKCE challenge is invalid.');
  }
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.configuration.clientId);
  url.searchParams.set('redirect_uri', input.configuration.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', googleRequestedScopes(input.bundle).join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
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
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) throw new ConnectorError('forbidden', `${operation} was refused.`);
    if (response.status === 429 || response.status >= 500) throw new ConnectorError('provider-retryable', `${operation} is temporarily unavailable.`);
    throw new ConnectorError('provider-disabled', `${operation} failed safely.`);
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ConnectorError('provider-disabled', `${operation} returned invalid JSON.`);
  }
}

export async function exchangeGoogleOAuthCode(input: {
  readonly configuration: GoogleOAuthConfiguration;
  readonly code: string;
  readonly codeVerifier: string;
  readonly requestedBundle: GoogleFeatureBundle;
  readonly fetcher?: GoogleFetch;
}): Promise<GoogleOAuthExchange> {
  if (!input.code || input.code.length > 2_048 || /[\u0000-\u001f\u007f]/.test(input.code)
    || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeVerifier)) {
    throw new ConnectorError('invalid-input', 'Google OAuth code or verifier is invalid.');
  }
  const fetcher = input.fetcher ?? fetch;
  const tokenResponse = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.configuration.clientId,
      client_secret: input.configuration.clientSecret,
      redirect_uri: input.configuration.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.codeVerifier,
    }),
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  const token = await boundedJson(tokenResponse, 'Google OAuth token exchange');
  const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
  const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : undefined;
  const expiresInSeconds = Number(token.expires_in);
  const grantedScopes = typeof token.scope === 'string'
    ? [...new Set(token.scope.split(/\s+/).filter(Boolean))].sort()
    : [];
  const required = googleRequestedScopes(input.requestedBundle);
  const identityGranted = GOOGLE_IDENTITY_SCOPES.every((scope) => (
    isGoogleScopeGranted(grantedScopes, scope)
  ));
  const operationalGrantPresent = GOOGLE_BUNDLE_SCOPES[input.requestedBundle]
    .some((scope) => grantedScopes.includes(scope));
  const requestedGrantComplete = required.every((scope) => (
    isGoogleScopeGranted(grantedScopes, scope)
  ));
  const grantIsUsable = requestedGrantComplete || (
    input.requestedBundle === 'workspace-core'
    && identityGranted
    && operationalGrantPresent
  );
  if (!accessToken || accessToken.length > 8_192 || (refreshToken?.length ?? 0) > 8_192
    || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 86_400
    || !grantIsUsable) {
    throw new ConnectorError('forbidden', 'Google did not grant the requested feature bundle.');
  }
  const identityResponse = await fetcher(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  return {
    accessToken, refreshToken, expiresInSeconds, grantedScopes,
    identity: parseGoogleAccountIdentity(await boundedJson(identityResponse, 'Google account identity')),
  };
}

export async function readGoogleAccountIdentity(
  accessToken: string,
  fetcher: GoogleFetch = fetch,
): Promise<GoogleAccountIdentity> {
  if (!accessToken || accessToken.length > 8_192 || /[\u0000-\u001f\u007f]/.test(accessToken)) {
    throw new ConnectorError('invalid-input', 'Google access token is invalid.');
  }
  const response = await fetcher(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  return parseGoogleAccountIdentity(await boundedJson(response, 'Google account identity'));
}

export async function refreshGoogleAccessToken(input: {
  readonly configuration: GoogleOAuthConfiguration;
  readonly refreshToken: string;
  readonly fetcher?: GoogleFetch;
}): Promise<GoogleAccessTokenRefresh> {
  if (!input.refreshToken || input.refreshToken.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(input.refreshToken)) {
    throw new ConnectorError('invalid-input', 'Google refresh token is invalid.');
  }
  const response = await (input.fetcher ?? fetch)(TOKEN_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.configuration.clientId,
      client_secret: input.configuration.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
    }),
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  const token = await boundedJson(response, 'Google access-token refresh');
  const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
  const expiresInSeconds = Number(token.expires_in);
  const grantedScopes = typeof token.scope === 'string'
    ? [...new Set(token.scope.split(/\s+/).filter(Boolean))].sort()
    : undefined;
  if (!accessToken || accessToken.length > 8_192
    || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 86_400) {
    throw new ConnectorError('forbidden', 'Google did not return a valid refreshed access token.');
  }
  return { accessToken, expiresInSeconds, ...(grantedScopes ? { grantedScopes } : {}) };
}

export async function revokeGoogleOAuthGrant(token: string, fetcher: GoogleFetch = fetch): Promise<void> {
  if (!token || token.length > 8_192 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new ConnectorError('invalid-input', 'Google revocation token is invalid.');
  }
  const response = await fetcher(REVOCATION_ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }), redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) throw new ConnectorError('provider-retryable', 'Google revocation is temporarily unavailable.');
    throw new ConnectorError('forbidden', 'Google revocation was not confirmed.');
  }
}

export interface GoogleGmailSendOperation {
  readonly rawMessageBase64Url: string;
}

export interface GoogleCalendarEventOperation {
  readonly calendarId: string;
  readonly eventId?: string;
  readonly summary: string;
  readonly start: { readonly dateTime: string; readonly timeZone: string };
  readonly end: { readonly dateTime: string; readonly timeZone: string };
  readonly omnix: {
    readonly taskId: string;
    readonly taskVersion: number;
    readonly resourceKey: string;
    readonly contentHash: string;
  };
}

export class GoogleWorkspaceClient {
  private readonly accessToken: string;
  private readonly fetcher: GoogleFetch;

  constructor(accessToken: string, fetcher: GoogleFetch = fetch) {
    if (!accessToken || accessToken.length > 8_192 || /[\u0000-\u001f\u007f]/.test(accessToken)) {
      throw new ConnectorError('configuration-required', 'Google access token is invalid.');
    }
    this.accessToken = accessToken;
    this.fetcher = fetcher;
  }

  private async request(url: string, operation: string, init: RequestInit = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || ![
      'gmail.googleapis.com', 'www.googleapis.com',
    ].includes(parsed.hostname)) {
      throw new ConnectorError('invalid-input', 'Google API endpoint is invalid.');
    }
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        accept: 'application/json', authorization: `Bearer ${this.accessToken}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    return boundedJson(response, operation);
  }

  private async response(url: string, init: RequestInit = {}): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['gmail.googleapis.com', 'www.googleapis.com'].includes(parsed.hostname)) {
      throw new ConnectorError('invalid-input', 'Google API endpoint is invalid.');
    }
    return this.fetcher(url, {
      ...init,
      headers: {
        accept: 'application/json', authorization: `Bearer ${this.accessToken}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      redirect: 'error', signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  }

  async probeProfile(): Promise<{ readonly emailAddress: string; readonly historyId: string }> {
    const payload = await this.request('https://gmail.googleapis.com/gmail/v1/users/me/profile', 'Google Gmail profile');
    if (typeof payload.emailAddress !== 'string' || typeof payload.historyId !== 'string'
      || !payload.emailAddress.includes('@') || !/^\d+$/.test(payload.historyId)) {
      throw new ConnectorError('provider-disabled', 'Google Gmail profile response is invalid.');
    }
    return { emailAddress: payload.emailAddress.toLowerCase(), historyId: payload.historyId };
  }

  async sendGmail(input: GoogleGmailSendOperation): Promise<{ readonly messageId: string; readonly threadId: string }> {
    if (!/^[A-Za-z0-9_-]{1,100000}$/.test(input.rawMessageBase64Url)) {
      throw new ConnectorError('invalid-input', 'Google Gmail message payload is invalid.');
    }
    const payload = await this.request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'Google Gmail send', {
      method: 'POST', body: JSON.stringify({ raw: input.rawMessageBase64Url }),
    });
    if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 256
      || typeof payload.threadId !== 'string' || !payload.threadId || payload.threadId.length > 256) {
      throw new ConnectorError('provider-disabled', 'Google Gmail send response is invalid.');
    }
    return { messageId: payload.id, threadId: payload.threadId };
  }

  async listRecentGmailMessageIds(maxResults = 100): Promise<readonly string[]> {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      throw new ConnectorError('invalid-input', 'Google Gmail reconciliation bound is invalid.');
    }
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.append('labelIds', 'SENT');
    const payload = await this.request(url.toString(), 'Google Gmail sent reconciliation');
    if (payload.messages !== undefined && !Array.isArray(payload.messages)) {
      throw new ConnectorError('provider-disabled', 'Google Gmail reconciliation response is invalid.');
    }
    return (payload.messages ?? []).flatMap((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
      const id = (message as Record<string, unknown>).id;
      return typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(id) ? [id] : [];
    });
  }

  async listRecentGmailMetadataIds(maxResults = 100): Promise<readonly string[]> {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500) {
      throw new ConnectorError('invalid-input', 'Google Gmail metadata sync bound is invalid.');
    }
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', String(maxResults));
    const payload = await this.request(url.toString(), 'Google Gmail initial metadata sync');
    if (payload.messages !== undefined && !Array.isArray(payload.messages)) {
      throw new ConnectorError('provider-disabled', 'Google Gmail metadata sync response is invalid.');
    }
    return (payload.messages ?? []).flatMap((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
      const id = (message as Record<string, unknown>).id;
      return typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(id) ? [id] : [];
    });
  }

  async findSentMessageByClientMessageId(
    clientMessageId: string,
    maxResults = 100,
  ): Promise<{ readonly messageId: string; readonly threadId: string } | undefined> {
    if (!/^[a-z0-9._-]{16,128}@[a-z0-9.-]{3,120}$/.test(clientMessageId)
      || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      throw new ConnectorError('invalid-input', 'Google Gmail reconciliation key is invalid.');
    }
    const ids = await this.listRecentGmailMessageIds(maxResults);
    const matches: { messageId: string; threadId: string }[] = [];
    for (const id of ids) {
      const metadata = await this.getGmailMetadata(id);
      if (metadata.messageIdHeader?.trim().toLowerCase() === `<${clientMessageId}>`.toLowerCase()) {
        matches.push({ messageId: metadata.messageId, threadId: metadata.threadId });
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  async watchGmail(input: { readonly topicName: string }): Promise<{
    readonly historyId: string; readonly expiresAt: string;
  }> {
    if (!/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/.test(input.topicName)) {
      throw new ConnectorError('invalid-input', 'Google Gmail Pub/Sub topic is invalid.');
    }
    const payload = await this.request('https://gmail.googleapis.com/gmail/v1/users/me/watch', 'Google Gmail watch', {
      method: 'POST', body: JSON.stringify({ topicName: input.topicName }),
    });
    if (typeof payload.historyId !== 'string' || !/^\d+$/.test(payload.historyId)
      || typeof payload.expiration !== 'string' || !/^\d+$/.test(payload.expiration)) {
      throw new ConnectorError('provider-disabled', 'Google Gmail watch response is invalid.');
    }
    const expiration = new Date(Number(payload.expiration));
    if (!Number.isFinite(expiration.getTime())) {
      throw new ConnectorError('provider-disabled', 'Google Gmail watch expiry is invalid.');
    }
    return { historyId: payload.historyId, expiresAt: expiration.toISOString() };
  }

  async stopGmailWatch(): Promise<void> {
    const response = await this.response('https://gmail.googleapis.com/gmail/v1/users/me/stop', { method: 'POST' });
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new ConnectorError('provider-retryable', 'Google Gmail watch stop is temporarily unavailable.');
      }
      throw new ConnectorError('forbidden', 'Google Gmail watch stop was not confirmed.');
    }
  }

  async listGmailHistory(input: {
    readonly startHistoryId: string;
    readonly pageToken?: string;
    readonly maxResults?: number;
  }): Promise<{ readonly messageIds: readonly string[]; readonly historyId: string; readonly nextPageToken?: string }> {
    const max = input.maxResults ?? 100;
    if (!/^\d+$/.test(input.startHistoryId) || !Number.isInteger(max) || max < 1 || max > 500
      || (input.pageToken !== undefined && !/^[A-Za-z0-9._-]{1,1024}$/.test(input.pageToken))) {
      throw new ConnectorError('invalid-input', 'Google Gmail history request is invalid.');
    }
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
    url.searchParams.set('startHistoryId', input.startHistoryId);
    url.searchParams.set('maxResults', String(max));
    url.searchParams.append('historyTypes', 'messageAdded');
    url.searchParams.append('historyTypes', 'messageDeleted');
    if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
    const response = await this.response(url.toString());
    if (response.status === 404) throw new GoogleCursorExpiredError('gmail-history');
    const payload = await boundedJson(response, 'Google Gmail history');
    if (typeof payload.historyId !== 'string' || !/^\d+$/.test(payload.historyId)
      || (payload.history !== undefined && !Array.isArray(payload.history))) {
      throw new ConnectorError('provider-disabled', 'Google Gmail history response is invalid.');
    }
    const messageIds = [...new Set((payload.history ?? []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const row = entry as Record<string, unknown>;
      return ['messagesAdded', 'messagesDeleted'].flatMap((field) => {
        const values = row[field];
        if (!Array.isArray(values)) return [];
        return values.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const message = (item as Record<string, unknown>).message;
          if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
          const id = (message as Record<string, unknown>).id;
          return typeof id === 'string' && id.length <= 256 ? [id] : [];
        });
      });
    }))];
    return {
      messageIds, historyId: payload.historyId,
      ...(typeof payload.nextPageToken === 'string' ? { nextPageToken: payload.nextPageToken } : {}),
    };
  }

  async getGmailMetadata(messageId: string): Promise<GoogleGmailMetadataMessage> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(messageId)) {
      throw new ConnectorError('invalid-input', 'Google Gmail message ID is invalid.');
    }
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
    url.searchParams.set('format', 'metadata');
    for (const header of ['From', 'To', 'Date', 'Message-ID']) url.searchParams.append('metadataHeaders', header);
    const payload = await this.request(url.toString(), 'Google Gmail metadata');
    const headers = (payload.payload as Record<string, unknown> | undefined)?.headers;
    if (typeof payload.id !== 'string' || typeof payload.threadId !== 'string'
      || typeof payload.internalDate !== 'string' || !Array.isArray(payload.labelIds) || !Array.isArray(headers)) {
      throw new ConnectorError('provider-disabled', 'Google Gmail metadata response is invalid.');
    }
    const header = (name: string, optional = false) => {
      const candidate = headers.find((item) => item && typeof item === 'object'
        && !Array.isArray(item) && String((item as Record<string, unknown>).name).toLowerCase() === name.toLowerCase());
      const value = candidate && (candidate as Record<string, unknown>).value;
      if (optional && value === undefined) return undefined;
      if (typeof value !== 'string' || !value || value.length > 998) {
        throw new ConnectorError('conflict', 'Google Gmail metadata address requires review.');
      }
      return value;
    };
    const instant = new Date(Number(payload.internalDate));
    if (!Number.isFinite(instant.getTime())) throw new ConnectorError('provider-disabled', 'Google Gmail timestamp is invalid.');
    const from = header('From');
    const to = header('To');
    if (!from || !to) throw new ConnectorError('conflict', 'Google Gmail metadata address requires review.');
    const messageIdHeader = header('Message-ID', true);
    return {
      messageId: payload.id, threadId: payload.threadId, internalDate: instant.toISOString(),
      labels: payload.labelIds.flatMap((label) => typeof label === 'string' && label.length <= 128 ? [label] : []),
      from, to, ...(messageIdHeader ? { messageIdHeader } : {}),
    };
  }

  async createOmnixCalendar(summary = 'Omnix CRM'): Promise<{ readonly calendarId: string; readonly etag?: string }> {
    if (!summary.trim() || summary.length > 120 || /[\u0000-\u001f\u007f]/.test(summary)) {
      throw new ConnectorError('invalid-input', 'Google calendar name is invalid.');
    }
    const payload = await this.request('https://www.googleapis.com/calendar/v3/calendars', 'Google Calendar create', {
      method: 'POST', body: JSON.stringify({ summary: summary.trim(), description: 'Follow-ups created by Omnix CRM.' }),
    });
    if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 1024) {
      throw new ConnectorError('provider-disabled', 'Google Calendar create response is invalid.');
    }
    return { calendarId: payload.id, ...(typeof payload.etag === 'string' ? { etag: payload.etag } : {}) };
  }

  async upsertOmnixCalendarEvent(input: GoogleCalendarEventOperation): Promise<{
    readonly eventId: string;
    readonly etag?: string;
    readonly updatedAt?: string;
  }> {
    const timezone = (value: string) => {
      try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date()); return value; }
      catch { throw new ConnectorError('invalid-input', 'Google event timezone is invalid.'); }
    };
    if (!input.calendarId || input.calendarId.length > 1024 || input.calendarId.includes('/')
      || (input.eventId !== undefined && !/^[a-v0-9]{5,1024}$/.test(input.eventId))
      || !input.summary.trim() || input.summary.length > 160
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.omnix.taskId)
      || !Number.isSafeInteger(input.omnix.taskVersion) || input.omnix.taskVersion < 1
      || !/^[0-9a-f]{64}$/.test(input.omnix.resourceKey)
      || !/^[0-9a-f]{64}$/.test(input.omnix.contentHash)
      || !Number.isFinite(new Date(input.start.dateTime).getTime())
      || !Number.isFinite(new Date(input.end.dateTime).getTime())) {
      throw new ConnectorError('invalid-input', 'Google calendar event payload is invalid.');
    }
    const calendarId = encodeURIComponent(input.calendarId);
    const eventId = input.eventId ? encodeURIComponent(input.eventId) : undefined;
    const body = {
      ...(input.eventId ? { id: input.eventId } : {}),
      summary: input.summary.trim(),
      start: { dateTime: new Date(input.start.dateTime).toISOString(), timeZone: timezone(input.start.timeZone) },
      end: { dateTime: new Date(input.end.dateTime).toISOString(), timeZone: timezone(input.end.timeZone) },
      extendedProperties: { private: {
        omnix: 'true', taskId: input.omnix.taskId,
        taskVersion: String(input.omnix.taskVersion), resourceKey: input.omnix.resourceKey,
        contentHash: input.omnix.contentHash,
      } },
    };
    let response = await this.response(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events${eventId ? `/${eventId}` : ''}`,
      { method: eventId ? 'PATCH' : 'POST', body: JSON.stringify(body) },
    );
    if (eventId && response.status === 404) {
      response = await this.response(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
        method: 'POST', body: JSON.stringify(body),
      });
    }
    const payload = await boundedJson(response, 'Google Calendar event write');
    if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 1024) {
      throw new ConnectorError('provider-disabled', 'Google Calendar event response is invalid.');
    }
    return {
      eventId: payload.id,
      ...(typeof payload.etag === 'string' ? { etag: payload.etag } : {}),
      ...(typeof payload.updated === 'string' ? { updatedAt: payload.updated } : {}),
    };
  }

  async getOmnixCalendarEvent(input: { readonly calendarId: string; readonly eventId: string }): Promise<{
    readonly eventId: string; readonly etag?: string; readonly updatedAt?: string;
  } | undefined> {
    if (!input.calendarId || input.calendarId.length > 1024 || input.calendarId.includes('/')
      || !/^[a-v0-9]{5,1024}$/.test(input.eventId)) {
      throw new ConnectorError('invalid-input', 'Google calendar event identity is invalid.');
    }
    const response = await this.response(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    );
    if (response.status === 404) return undefined;
    const payload = await boundedJson(response, 'Google Calendar event reconciliation');
    if (payload.id !== input.eventId || payload.status === 'cancelled') return undefined;
    return {
      eventId: input.eventId,
      ...(typeof payload.etag === 'string' ? { etag: payload.etag } : {}),
      ...(typeof payload.updated === 'string' ? { updatedAt: payload.updated } : {}),
    };
  }

  async deleteOmnixCalendarEvent(input: { readonly calendarId: string; readonly eventId: string }): Promise<void> {
    if (!input.calendarId || input.calendarId.length > 1024 || input.calendarId.includes('/')
      || !/^[a-v0-9]{5,1024}$/.test(input.eventId)) {
      throw new ConnectorError('invalid-input', 'Google calendar event identity is invalid.');
    }
    const response = await this.response(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      { method: 'DELETE' },
    );
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new ConnectorError('provider-retryable', 'Google Calendar event deletion is temporarily unavailable.');
      }
      throw new ConnectorError('forbidden', 'Google Calendar event deletion was refused.');
    }
  }

  async listOmnixCalendarEvents(input: {
    readonly calendarId: string;
    readonly syncToken?: string;
    readonly pageToken?: string;
    readonly maxResults?: number;
    readonly timeMin?: string;
  }): Promise<{ readonly events: readonly Record<string, unknown>[]; readonly nextPageToken?: string; readonly nextSyncToken?: string }> {
    const max = input.maxResults ?? 100;
    if (!input.calendarId || input.calendarId.length > 1024 || input.calendarId.includes('/')
      || !Number.isInteger(max) || max < 1 || max > 2500
      || (input.syncToken !== undefined && (!input.syncToken || input.syncToken.length > 4096))
      || (input.pageToken !== undefined && (!input.pageToken || input.pageToken.length > 4096))) {
      throw new ConnectorError('invalid-input', 'Google Calendar sync request is invalid.');
    }
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`);
    url.searchParams.set('maxResults', String(max));
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted', 'true');
    url.searchParams.set('privateExtendedProperty', 'omnix=true');
    if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
    if (input.syncToken) url.searchParams.set('syncToken', input.syncToken);
    else if (input.timeMin) {
      const timeMin = new Date(input.timeMin);
      if (!Number.isFinite(timeMin.getTime())) throw new ConnectorError('invalid-input', 'Google Calendar initial range is invalid.');
      url.searchParams.set('timeMin', timeMin.toISOString());
    }
    const response = await this.response(url.toString());
    if (response.status === 410) throw new GoogleCursorExpiredError('calendar-events');
    const payload = await boundedJson(response, 'Google Calendar sync');
    if (!Array.isArray(payload.items)) throw new ConnectorError('provider-disabled', 'Google Calendar sync response is invalid.');
    return {
      events: payload.items.flatMap((event) => event && typeof event === 'object' && !Array.isArray(event)
        ? [event as Record<string, unknown>] : []),
      ...(typeof payload.nextPageToken === 'string' ? { nextPageToken: payload.nextPageToken } : {}),
      ...(typeof payload.nextSyncToken === 'string' ? { nextSyncToken: payload.nextSyncToken } : {}),
    };
  }
}
