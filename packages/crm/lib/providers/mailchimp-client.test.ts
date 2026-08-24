import { describe, expect, it, vi } from 'vitest';
import {
  MailchimpMarketingClient,
  createMailchimpAuthorizationUrl,
  exchangeMailchimpOAuthCode,
  loadMailchimpOAuthConfiguration,
} from './mailchimp-client';

const configuration = {
  clientId: 'client-a', clientSecret: 'secret-a',
  redirectUri: 'https://crm.example.com/api/connectors/mailchimp/callback',
};

describe('Mailchimp fixed-endpoint provider client', () => {
  it('loads server-only OAuth configuration and creates a state-bound authorization URL', () => {
    expect(loadMailchimpOAuthConfiguration({
      MAILCHIMP_CLIENT_ID: 'client-a', MAILCHIMP_CLIENT_SECRET: 'secret-a',
      MAILCHIMP_REDIRECT_URI: configuration.redirectUri,
    })).toEqual(configuration);
    const url = new URL(createMailchimpAuthorizationUrl({ configuration, state: 'a'.repeat(43) }));
    expect(url.origin).toBe('https://login.mailchimp.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('state')).toBe('a'.repeat(43));
  });

  it('exchanges at fixed endpoints and derives the API host only from authenticated metadata', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accountname: 'Realtor', login: 'owner', dc: 'us21' }), { status: 200 }));
    const result = await exchangeMailchimpOAuthCode({ configuration, code: 'temporary-code', fetcher });
    expect(result).toMatchObject({
      accessToken: 'oauth-token',
      identity: { accountName: 'Realtor', dataCenter: 'us21', apiBaseUrl: 'https://us21.api.mailchimp.com/3.0' },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://login.mailchimp.com/oauth2/token');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://login.mailchimp.com/oauth2/metadata');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { authorization: 'OAuth oauth-token' } });
  });

  it('uses bounded list and tag endpoints without accepting arbitrary hosts', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        lists: [{ id: 'audience-a', name: 'Primary', stats: { member_count: 220 } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: [{ name: 'Omnix: Hot' }, { name: 'Preserved' }] }), { status: 200 }));
    const client = new MailchimpMarketingClient('us21', 'oauth-token', fetcher);
    await expect(client.listAudiences(50)).resolves.toEqual([
      { id: 'audience-a', name: 'Primary', memberCount: 220 },
    ]);
    await client.setOmnixLeadTag({
      audienceId: 'audience-a', subscriberHash: 'a'.repeat(32), tagName: 'Omnix: Hot',
    });
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/^https:\/\/us21\.api\.mailchimp\.com\/3\.0\/lists/);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: 'Bearer oauth-token' }),
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `https://us21.api.mailchimp.com/3.0/lists/audience-a/members/${'a'.repeat(32)}/tags`,
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ tags: [
      { name: 'Omnix: Hot', status: 'active' },
      { name: 'Omnix: Warm', status: 'inactive' },
      { name: 'Omnix: Nurture', status: 'inactive' },
    ] });
    await expect(client.listMemberTagNames({
      audienceId: 'audience-a', subscriberHash: 'a'.repeat(32),
    })).resolves.toEqual(['Omnix: Hot', 'Preserved']);
    expect(() => new MailchimpMarketingClient('evil.example.com', 'token', fetcher)).toThrow(/data center is invalid/i);
  });

  it('creates a signed selected-audience webhook and returns the one-time secret', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'webhook-a', signing_secret: 'one-time-signing-secret',
    }), { status: 200 }));
    const client = new MailchimpMarketingClient('us21', 'token-a', fetcher as never);
    await expect(client.createSignedAudienceWebhook({
      audienceId: 'audience-a',
      callbackUrl: 'https://crm.example.com/api/connectors/mailchimp/webhook/opaque-key',
    })).resolves.toEqual({ webhookId: 'webhook-a', signingSecret: 'one-time-signing-secret' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/lists/audience-a/webhooks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          url: 'https://crm.example.com/api/connectors/mailchimp/webhook/opaque-key',
          events: { subscribe: true, unsubscribe: true, profile: true, cleaned: true },
          sources: { user: true, admin: true, api: true },
        }),
      }),
    );
  });

  it('deletes an orphaned selected-audience webhook by its exact provider identity', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new MailchimpMarketingClient('us21', 'token-a', fetcher);
    await expect(client.deleteAudienceWebhook({ audienceId: 'audience-a', webhookId: 'webhook-a' }))
      .resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/lists/audience-a/webhooks/webhook-a',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns a bounded canonical member page for baseline reconciliation', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
      members: [{
        id: 'member-a', email_address: 'Ada@Example.com', status: 'unsubscribed',
        last_changed: '2026-08-11T12:00:00Z',
      }],
      total_items: 1,
      }), { status: 200 });
    };
    const client = new MailchimpMarketingClient('us21', 'token-a', fetcher);
    await expect(client.listAudienceMembers({ audienceId: 'audience-a', count: 100, offset: 0 }))
      .resolves.toMatchObject({
        totalItems: 1,
        members: [{ memberId: 'member-a', normalizedEmail: 'ada@example.com', subscriptionStatus: 'unsubscribed' }],
      });
    expect(calls[0]).toContain('/lists/audience-a/members?count=100&offset=0');
  });

  it('classifies 429 and 5xx responses as retryable without returning provider bodies', async () => {
    const client429 = new MailchimpMarketingClient('us21', 'token-a', async () => new Response(
      JSON.stringify({ detail: 'raw provider error with PII' }),
      { status: 429 },
    ));
    await expect(client429.listAudiences()).rejects.toMatchObject({ code: 'provider-retryable' });

    const client500 = new MailchimpMarketingClient('us21', 'token-a', async () => new Response('secret body', { status: 503 }));
    await expect(client500.listAudiences()).rejects.toMatchObject({ code: 'provider-retryable' });
  });

  it('uses the fixed read-only ping endpoint for connection health', async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      health_status: "Everything's Chimpy!",
    }), { status: 200 }));
    const client = new MailchimpMarketingClient('us21', 'token-a', fetcher);
    await expect(client.ping()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/ping',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
});
