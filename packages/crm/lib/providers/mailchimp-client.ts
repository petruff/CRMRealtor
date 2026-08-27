import { ConnectorError } from '../domain/connector.ts';
import {
  MAILCHIMP_LEAD_TAGS,
  mailchimpSubscriberHash,
  createMailchimpAccountIdentity,
  parseMailchimpAudience,
  parseMailchimpDataCenter,
  type MailchimpAccountIdentity,
  type MailchimpAudience,
  type MailchimpAudienceMember,
  parseMailchimpAudienceMember,
} from '../domain/mailchimp.ts';
import { mailchimpSegmentOptions, parseMailchimpCampaignContent, parseMailchimpCampaignSegment,
  type MailchimpCampaignContent, type MailchimpCampaignSegment } from '../domain/mailchimp-campaign.ts';

const AUTHORIZE_ENDPOINT = 'https://login.mailchimp.com/oauth2/authorize';
const TOKEN_ENDPOINT = 'https://login.mailchimp.com/oauth2/token';
const METADATA_ENDPOINT = 'https://login.mailchimp.com/oauth2/metadata';
const MAX_RESPONSE_BYTES = 1_048_576;

export interface MailchimpOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface MailchimpOAuthExchange {
  readonly accessToken: string;
  readonly identity: MailchimpAccountIdentity;
}

export type MailchimpFetch = typeof fetch;

function configuration(value: string | undefined, name: string): string {
  const clean = value?.trim();
  if (!clean || clean.length > 4_096 || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return clean;
}

export function loadMailchimpOAuthConfiguration(
  environment: Record<string, string | undefined> = process.env,
): MailchimpOAuthConfiguration {
  const redirectUri = configuration(environment.MAILCHIMP_REDIRECT_URI, 'MAILCHIMP_REDIRECT_URI');
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new ConnectorError('configuration-required', 'MAILCHIMP_REDIRECT_URI is invalid.');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(redirect.hostname);
  if (redirect.username || redirect.password || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && loopback))) {
    throw new ConnectorError('configuration-required', 'MAILCHIMP_REDIRECT_URI must be HTTPS or loopback HTTP.');
  }
  return {
    clientId: configuration(environment.MAILCHIMP_CLIENT_ID, 'MAILCHIMP_CLIENT_ID'),
    clientSecret: configuration(environment.MAILCHIMP_CLIENT_SECRET, 'MAILCHIMP_CLIENT_SECRET'),
    redirectUri: redirect.toString(),
  };
}

export function createMailchimpAuthorizationUrl(input: {
  readonly configuration: MailchimpOAuthConfiguration;
  readonly state: string;
}): string {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.state)) {
    throw new ConnectorError('invalid-input', 'Mailchimp OAuth state is invalid.');
  }
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.configuration.clientId);
  url.searchParams.set('redirect_uri', input.configuration.redirectUri);
  url.searchParams.set('state', input.state);
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
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorError('forbidden', `${operation} failed with status ${response.status}.`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ConnectorError('provider-retryable', `${operation} failed with a retryable provider status.`);
    }
    throw new ConnectorError('provider-disabled', `${operation} failed with status ${response.status}.`);
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ConnectorError('provider-disabled', `${operation} returned invalid JSON.`);
  }
}

export async function exchangeMailchimpOAuthCode(input: {
  readonly configuration: MailchimpOAuthConfiguration;
  readonly code: string;
  readonly fetcher?: MailchimpFetch;
}): Promise<MailchimpOAuthExchange> {
  if (!input.code || input.code.length > 2_048 || /[\u0000-\u001f\u007f]/.test(input.code)) {
    throw new ConnectorError('invalid-input', 'Mailchimp OAuth code is invalid.');
  }
  const fetcher = input.fetcher ?? fetch;
  const tokenResponse = await fetcher(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.configuration.clientId,
      client_secret: input.configuration.clientSecret,
      redirect_uri: input.configuration.redirectUri,
      code: input.code,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const token = await boundedJson(tokenResponse, 'Mailchimp OAuth token exchange');
  if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8_192) {
    throw new ConnectorError('provider-disabled', 'Mailchimp OAuth token response is invalid.');
  }
  const metadataResponse = await fetcher(METADATA_ENDPOINT, {
    headers: { authorization: `OAuth ${token.access_token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const metadata = await boundedJson(metadataResponse, 'Mailchimp OAuth metadata');
  return {
    accessToken: token.access_token,
    identity: createMailchimpAccountIdentity({
      accountId: metadata.accountname ?? metadata.login?.toString() ?? metadata.user_id,
      accountName: metadata.accountname ?? metadata.login,
      dataCenter: metadata.dc,
    }),
  };
}

export class MailchimpMarketingClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly fetcher: MailchimpFetch;

  constructor(
    dataCenter: string,
    accessToken: string,
    fetcher: MailchimpFetch = fetch,
  ) {
    const dc = parseMailchimpDataCenter(dataCenter);
    if (!accessToken || accessToken.length > 8_192) throw new ConnectorError('configuration-required', 'Mailchimp access token is invalid.');
    this.baseUrl = `https://${dc}.api.mailchimp.com/3.0`;
    this.accessToken = accessToken;
    this.fetcher = fetcher;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    allowEmptySuccess = false,
  ): Promise<Record<string, unknown>> {
    if (!path.startsWith('/') || path.includes('..') || /[\u0000-\u001f\u007f]/.test(path)) {
      throw new ConnectorError('invalid-input', 'Mailchimp API path is invalid.');
    }
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.accessToken}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    if (allowEmptySuccess && response.ok && [202, 204].includes(response.status)) return {};
    return boundedJson(response, 'Mailchimp Marketing API request');
  }

  async ping(): Promise<void> {
    const payload = await this.request('/ping');
    if (typeof payload.health_status !== 'string' || !payload.health_status.trim()
      || payload.health_status.length > 160) {
      throw new ConnectorError('provider-disabled', 'Mailchimp health response is invalid.');
    }
  }

  async createCampaignDraft(input: {
    readonly audienceId: string;
    readonly segment: MailchimpCampaignSegment;
    readonly content: MailchimpCampaignContent;
  }): Promise<{ readonly campaignId: string; readonly webId?: number }> {
    const audienceId = parseMailchimpAudience({ id: input.audienceId, name: 'Selected audience' }).id;
    const segment = parseMailchimpCampaignSegment(input.segment);
    const content = parseMailchimpCampaignContent(input.content);
    let savedSegmentId: number | undefined;
    const segmentTarget = mailchimpSegmentOptions(segment);
    if (segmentTarget) {
      const tagName = String(segmentTarget.tagName);
      const tags = await this.request(`/lists/${encodeURIComponent(audienceId)}/tag-search?name=${encodeURIComponent(tagName)}`);
      const exact = Array.isArray(tags.tags) ? tags.tags.find((candidate) => candidate && typeof candidate === 'object'
        && !Array.isArray(candidate) && (candidate as Record<string, unknown>).name === tagName) : undefined;
      const id = exact && typeof exact === 'object' ? Number((exact as Record<string, unknown>).id) : NaN;
      if (!Number.isSafeInteger(id) || id < 1) {
        throw new ConnectorError('conflict', `Mailchimp tag ${tagName} is not ready. Run contact tag sync first.`);
      }
      savedSegmentId = id;
    }
    const payload = await this.request('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        type: 'regular',
        recipients: { list_id: audienceId, ...(savedSegmentId ? { segment_opts: { saved_segment_id: savedSegmentId } } : {}) },
        settings: { title: content.title, subject_line: content.subject, preview_text: content.previewText,
          from_name: content.fromName, reply_to: content.replyTo, auto_footer: true },
      }),
    });
    if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 128) {
      throw new ConnectorError('provider-disabled', 'Mailchimp campaign draft response is invalid.');
    }
    const webId = Number(payload.web_id);
    return { campaignId: payload.id, ...(Number.isSafeInteger(webId) && webId > 0 ? { webId } : {}) };
  }

  async setCampaignContent(input: { readonly campaignId: string; readonly content: MailchimpCampaignContent }): Promise<void> {
    const campaignId = parseMailchimpAudience({ id: input.campaignId, name: 'Campaign' }).id;
    const content = parseMailchimpCampaignContent(input.content);
    await this.request(`/campaigns/${encodeURIComponent(campaignId)}/content`, {
      method: 'PUT', body: JSON.stringify({ html: content.html, plain_text: content.plainText }),
    });
  }

  async findCampaignDraft(input: {
    readonly audienceId: string;
    readonly providerTitle: string;
    readonly createdSince: string;
  }): Promise<{ readonly campaignId: string } | undefined> {
    const audienceId = parseMailchimpAudience({ id: input.audienceId, name: 'Selected audience' }).id;
    const providerTitle = parseMailchimpCampaignContent({
      title: input.providerTitle,
      subject: 'Recovery lookup',
      previewText: 'Recovery lookup',
      fromName: 'Omnix',
      replyTo: 'recovery@example.com',
      html: 'Recovery lookup',
      plainText: 'Recovery lookup',
    }).title;
    const since = new Date(input.createdSince);
    if (!Number.isFinite(since.getTime())) throw new ConnectorError('invalid-input', 'Campaign recovery timestamp is invalid.');
    const query = new URLSearchParams({
      count: '100',
      status: 'save',
      list_id: audienceId,
      since_create_time: since.toISOString(),
      sort_field: 'create_time',
      sort_dir: 'DESC',
      fields: 'campaigns.id,campaigns.settings.title,campaigns.recipients.list_id,total_items',
    });
    const payload = await this.request(`/campaigns?${query.toString()}`);
    if (!Array.isArray(payload.campaigns)) {
      throw new ConnectorError('provider-disabled', 'Mailchimp campaign recovery response is invalid.');
    }
    const matches = payload.campaigns.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const row = entry as Record<string, unknown>;
      const settings = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
        ? row.settings as Record<string, unknown> : {};
      const recipients = row.recipients && typeof row.recipients === 'object' && !Array.isArray(row.recipients)
        ? row.recipients as Record<string, unknown> : {};
      return settings.title === providerTitle && recipients.list_id === audienceId
        && typeof row.id === 'string' && row.id.length <= 128 ? [{ campaignId: row.id }] : [];
    });
    if (matches.length > 1) {
      throw new ConnectorError('conflict', 'Multiple matching Mailchimp drafts require manual review.');
    }
    return matches[0];
  }

  async readCampaignStatus(campaignIdValue: string): Promise<'save' | 'paused' | 'schedule' | 'sending' | 'sent'> {
    const campaignId = parseMailchimpAudience({ id: campaignIdValue, name: 'Campaign' }).id;
    const payload = await this.request(`/campaigns/${encodeURIComponent(campaignId)}?fields=id,status`);
    if (!['save', 'paused', 'schedule', 'sending', 'sent'].includes(String(payload.status))) {
      throw new ConnectorError('provider-disabled', 'Mailchimp campaign status is invalid.');
    }
    return payload.status as 'save' | 'paused' | 'schedule' | 'sending' | 'sent';
  }

  async readCampaignSendChecklist(campaignIdValue: string): Promise<{
    readonly ready: boolean;
    readonly issues: readonly string[];
  }> {
    const campaignId = parseMailchimpAudience({ id: campaignIdValue, name: 'Campaign' }).id;
    const payload = await this.request(`/campaigns/${encodeURIComponent(campaignId)}/send-checklist`);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const issues = items.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['Mailchimp returned an invalid checklist item.'];
      const item = entry as Record<string, unknown>;
      return item.type === 'error' && typeof item.heading === 'string' ? [item.heading.slice(0, 200)] : [];
    });
    return { ready: issues.length === 0, issues };
  }

  async sendCampaign(campaignIdValue: string): Promise<void> {
    const campaignId = parseMailchimpAudience({ id: campaignIdValue, name: 'Campaign' }).id;
    await this.request(`/campaigns/${encodeURIComponent(campaignId)}/actions/send`, { method: 'POST' }, true);
  }

  async createSignedAudienceWebhook(input: {
    readonly audienceId: string;
    readonly callbackUrl: string;
  }): Promise<{ readonly webhookId: string; readonly signingSecret: string }> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.audienceId)) {
      throw new ConnectorError('invalid-input', 'Mailchimp audience is invalid.');
    }
    let callback: URL;
    try {
      callback = new URL(input.callbackUrl);
    } catch {
      throw new ConnectorError('invalid-input', 'Mailchimp callback URL is invalid.');
    }
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(callback.hostname);
    if (callback.username || callback.password
      || (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && loopback))) {
      throw new ConnectorError('invalid-input', 'Mailchimp callback URL must be HTTPS or loopback HTTP.');
    }
    const payload = await this.request(`/lists/${input.audienceId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({
        url: callback.toString(),
        events: { subscribe: true, unsubscribe: true, profile: true, cleaned: true },
        sources: { user: true, admin: true, api: true },
      }),
    });
    if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 128
      || typeof payload.signing_secret !== 'string' || !payload.signing_secret
      || payload.signing_secret.length > 4_096) {
      throw new ConnectorError('provider-disabled', 'Mailchimp webhook response is invalid.');
    }
    return { webhookId: payload.id, signingSecret: payload.signing_secret };
  }

  async deleteAudienceWebhook(input: {
    readonly audienceId: string;
    readonly webhookId: string;
  }): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.audienceId)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(input.webhookId)) {
      throw new ConnectorError('invalid-input', 'Mailchimp webhook identity is invalid.');
    }
    await this.request(`/lists/${input.audienceId}/webhooks/${input.webhookId}`, {
      method: 'DELETE',
    }, true);
  }

  async listAudiences(limit = 100, offset = 0): Promise<readonly MailchimpAudience[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) {
      throw new ConnectorError('invalid-input', 'Mailchimp audience page is invalid.');
    }
    const payload = await this.request(`/lists?count=${limit}&offset=${offset}&fields=lists.id,lists.name,lists.stats.member_count`);
    if (!Array.isArray(payload.lists)) throw new ConnectorError('provider-disabled', 'Mailchimp audiences response is invalid.');
    return payload.lists.map((value) => {
      const row = value as Record<string, unknown>;
      const stats = row.stats as Record<string, unknown> | undefined;
      return parseMailchimpAudience({ id: row.id, name: row.name, memberCount: stats?.member_count });
    });
  }

  async listAudienceMembers(input: {
    readonly audienceId: string;
    readonly count?: number;
    readonly offset?: number;
  }): Promise<{ readonly members: readonly MailchimpAudienceMember[]; readonly totalItems: number }> {
    const count = input.count ?? 100;
    const offset = input.offset ?? 0;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.audienceId)
      || !Number.isInteger(count) || count < 1 || count > 500
      || !Number.isInteger(offset) || offset < 0) {
      throw new ConnectorError('invalid-input', 'Mailchimp member page is invalid.');
    }
    const fields = 'members.id,members.email_address,members.unique_email_id,members.status,members.last_changed,members.merge_fields,total_items';
    const payload = await this.request(`/lists/${input.audienceId}/members?count=${count}&offset=${offset}&fields=${fields}`);
    if (!Array.isArray(payload.members) || !Number.isSafeInteger(payload.total_items)
      || Number(payload.total_items) < 0) {
      throw new ConnectorError('provider-disabled', 'Mailchimp member page response is invalid.');
    }
    return {
      members: payload.members.map((value) => {
        const row = value as Record<string, unknown>;
        const normalizedEmail = typeof row.email_address === 'string' ? row.email_address.toLowerCase() : row.email_address;
        const mergeFields = row.merge_fields && typeof row.merge_fields === 'object' && !Array.isArray(row.merge_fields)
          ? row.merge_fields as Record<string, unknown>
          : {};
        const mergeValue = (...keys: readonly string[]) => keys
          .map((key) => mergeFields[key])
          .find((candidate) => typeof candidate === 'string' && candidate.trim());
        const inferredPhone = /^(\d{10})@kvleads\.com$/i.exec(String(normalizedEmail ?? ''))?.[1];
        return parseMailchimpAudienceMember({
          memberId: row.id ?? row.unique_email_id,
          subscriberHash: mailchimpSubscriberHash(String(normalizedEmail ?? '')),
          normalizedEmail,
          firstName: mergeValue('FNAME', 'FIRSTNAME', 'FIRST_NAME'),
          lastName: mergeValue('LNAME', 'LASTNAME', 'LAST_NAME'),
          phone: mergeValue('PHONE', 'MMERGE3', 'SMSPHONE') ?? inferredPhone,
          subscriptionStatus: row.status,
          lastChangedAt: row.last_changed,
        });
      }),
      totalItems: Number(payload.total_items),
    };
  }

  async setOmnixLeadTag(input: {
    readonly audienceId: string;
    readonly subscriberHash: string;
    readonly tagName: string;
  }): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.audienceId)
      || !/^[a-f0-9]{32}$/.test(input.subscriberHash)
      || !input.tagName || input.tagName.length > 100) {
      throw new ConnectorError('invalid-input', 'Mailchimp member tag operation is invalid.');
    }
    if (!Object.values(MAILCHIMP_LEAD_TAGS).includes(input.tagName as never)) {
      throw new ConnectorError('invalid-input', 'Mailchimp lead tag is outside the approved mapping.');
    }
    await this.request(`/lists/${input.audienceId}/members/${input.subscriberHash}/tags`, {
      method: 'POST',
      // Omnix owns only these three tags. Other Mailchimp tags are not named or
      // changed, while the two previous Omnix temperatures are removed.
      body: JSON.stringify({ tags: Object.values(MAILCHIMP_LEAD_TAGS).map((name) => ({
        name,
        status: name === input.tagName ? 'active' : 'inactive',
      })) }),
    });
  }

  async listMemberTagNames(input: {
    readonly audienceId: string;
    readonly subscriberHash: string;
  }): Promise<readonly string[]> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.audienceId)
      || !/^[a-f0-9]{32}$/.test(input.subscriberHash)) {
      throw new ConnectorError('invalid-input', 'Mailchimp member tag lookup is invalid.');
    }
    const payload = await this.request(`/lists/${input.audienceId}/members/${input.subscriberHash}/tags?count=100`);
    if (!Array.isArray(payload.tags)) throw new ConnectorError('provider-disabled', 'Mailchimp member tags response is invalid.');
    return payload.tags.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const name = (value as Record<string, unknown>).name;
      return typeof name === 'string' && name.length <= 100 ? [name] : [];
    });
  }
}
