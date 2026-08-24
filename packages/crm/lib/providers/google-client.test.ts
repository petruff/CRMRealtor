import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleAuthorizationUrl,
  exchangeGoogleOAuthCode,
  refreshGoogleAccessToken,
  readGoogleAccountIdentity,
  loadGoogleOAuthConfiguration,
  revokeGoogleOAuthGrant,
  GoogleWorkspaceClient,
  GoogleCursorExpiredError,
} from './google-client';

const configuration = {
  clientId: 'google-client', clientSecret: 'google-secret',
  redirectUri: 'https://crm.example.com/api/connectors/google/callback',
};

describe('Google fixed-endpoint OAuth client', () => {
  it('uses PKCE, offline access and one incremental feature bundle', () => {
    expect(loadGoogleOAuthConfiguration({
      GOOGLE_CONNECTOR_CLIENT_ID: 'google-client', GOOGLE_CONNECTOR_CLIENT_SECRET: 'google-secret',
      GOOGLE_CONNECTOR_REDIRECT_URI: configuration.redirectUri,
    })).toEqual(configuration);
    const url = new URL(createGoogleAuthorizationUrl({
      configuration, state: 'a'.repeat(43), codeChallenge: 'b'.repeat(43), bundle: 'gmail-send',
    }));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(url.searchParams.get('scope')).not.toContain('gmail.metadata');
  });

  it('exchanges at fixed endpoints and requires the exact granted bundle', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600,
        scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.metadata',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: 'google-user-1', email: 'owner@example.com', email_verified: true,
      }), { status: 200 }));
    const result = await exchangeGoogleOAuthCode({
      configuration, code: 'one-time-code', codeVerifier: 'v'.repeat(64), requestedBundle: 'gmail-metadata', fetcher,
    });
    expect(result).toMatchObject({ refreshToken: 'refresh-token', identity: { email: 'owner@example.com' } });
    expect(result.grantedScopes).toContain('https://www.googleapis.com/auth/userinfo.email');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain('code_verifier=');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://openidconnect.googleapis.com/v1/userinfo');
  });

  it('fails closed on a denied feature scope and uses the fixed revocation endpoint', async () => {
    const denied: typeof fetch = async () => new Response(JSON.stringify({
      access_token: 'access-token', expires_in: 3600, scope: 'openid email',
    }), { status: 200 });
    await expect(exchangeGoogleOAuthCode({
      configuration, code: 'one-time-code', codeVerifier: 'v'.repeat(64), requestedBundle: 'gmail-send', fetcher: denied,
    })).rejects.toMatchObject({ code: 'forbidden' });

    const revoke = vi.fn(async () => new Response('', { status: 200 }));
    await expect(revokeGoogleOAuthGrant('refresh-token', revoke)).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.objectContaining({ method: 'POST' }));
  });

  it('preserves a usable partial guided workspace grant but rejects identity-only consent', async () => {
    const partial = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600,
        scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: 'google-user-1', email: 'owner@example.com', email_verified: true,
      }), { status: 200 }));
    await expect(exchangeGoogleOAuthCode({
      configuration, code: 'one-time-code', codeVerifier: 'v'.repeat(64),
      requestedBundle: 'workspace-core', fetcher: partial,
    })).resolves.toMatchObject({
      grantedScopes: ['email', 'https://www.googleapis.com/auth/gmail.send', 'openid'],
    });

    const identityOnly: typeof fetch = async () => new Response(JSON.stringify({
      access_token: 'access-token', expires_in: 3600, scope: 'openid email',
    }), { status: 200 });
    await expect(exchangeGoogleOAuthCode({
      configuration, code: 'one-time-code', codeVerifier: 'v'.repeat(64),
      requestedBundle: 'workspace-core', fetcher: identityOnly,
    })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refreshes an access token only through the fixed token endpoint', async () => {
    const fetcher: typeof fetch = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({
        access_token: 'access-token-2', expires_in: 3600,
        scope: 'openid email https://www.googleapis.com/auth/gmail.send',
      }), { status: 200 });
    });
    await expect(refreshGoogleAccessToken({
      configuration, refreshToken: 'refresh-token', fetcher,
    })).resolves.toMatchObject({ accessToken: 'access-token-2', expiresInSeconds: 3600 });
    expect(fetcher).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST', body: expect.any(URLSearchParams),
    }));
    expect(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body)).toContain('grant_type=refresh_token');
  });

  it('probes the exact OIDC account identity without broad Gmail scopes', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      sub: 'google-user-1', email: 'Owner@Example.com', email_verified: true,
    }), { status: 200 }));
    await expect(readGoogleAccountIdentity('access-token', fetcher)).resolves.toMatchObject({
      subject: 'google-user-1', email: 'owner@example.com', displayLabel: 'owner@example.com',
    });
    expect(fetcher).toHaveBeenCalledWith('https://openidconnect.googleapis.com/v1/userinfo', expect.objectContaining({
      headers: { authorization: 'Bearer access-token' },
    }));
  });

  it('uses fixed Gmail and Calendar write endpoints with bounded payloads', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'message-a', threadId: 'thread-a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'calendar-a', etag: 'etag-a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'event123', etag: 'etag-b', updated: '2026-08-12T12:00:00Z' }), { status: 200 }));
    const client = new GoogleWorkspaceClient('access-token', fetcher);
    await expect(client.sendGmail({ rawMessageBase64Url: 'U3ViamVjdDogSGVsbG8' }))
      .resolves.toEqual({ messageId: 'message-a', threadId: 'thread-a' });
    const calendar = await client.createOmnixCalendar();
    await expect(client.upsertOmnixCalendarEvent({
      calendarId: calendar.calendarId, summary: 'Call Ada',
      start: { dateTime: '2026-08-12T14:00:00Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-08-12T14:30:00Z', timeZone: 'America/New_York' },
      omnix: { taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', taskVersion: 1,
        resourceKey: 'a'.repeat(64), contentHash: 'b'.repeat(64) },
    })).resolves.toMatchObject({ eventId: 'event123' });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      'https://www.googleapis.com/calendar/v3/calendars',
      'https://www.googleapis.com/calendar/v3/calendars/calendar-a/events',
    ]);
    expect(String(fetcher.mock.calls[2]?.[1]?.body)).toContain('"omnix":"true"');
    expect(String(fetcher.mock.calls[2]?.[1]?.body)).toContain('"taskId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
  });

  it('pages Gmail metadata without bodies or subjects and detects an expired history cursor', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        historyId: '102', history: [{ messagesAdded: [{ message: { id: 'message-a' } }] }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'message-a', threadId: 'thread-a', internalDate: '1786550400000', labelIds: ['SENT'],
        payload: { headers: [
          { name: 'From', value: 'Owner <owner@example.com>' },
          { name: 'To', value: 'buyer@example.com' },
          { name: 'Message-ID', value: '<key@omnix.local>' },
        ] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const client = new GoogleWorkspaceClient('access-token', fetcher);
    await expect(client.listGmailHistory({ startHistoryId: '100', maxResults: 500 }))
      .resolves.toMatchObject({ messageIds: ['message-a'], historyId: '102' });
    await expect(client.getGmailMetadata('message-a')).resolves.toMatchObject({
      messageId: 'message-a', from: 'Owner <owner@example.com>', to: 'buyer@example.com',
      messageIdHeader: '<key@omnix.local>', labels: ['SENT'],
    });
    const metadataUrl = new URL(String(fetcher.mock.calls[1]?.[0]));
    expect(metadataUrl.searchParams.get('format')).toBe('metadata');
    expect(metadataUrl.searchParams.getAll('metadataHeaders')).toEqual(['From', 'To', 'Date', 'Message-ID']);
    await expect(client.listGmailHistory({ startHistoryId: '1' })).rejects.toBeInstanceOf(GoogleCursorExpiredError);
  });

  it('reconciles a sent Message-ID with a bounded no-query metadata scan', async () => {
    const metadata = (id: string, messageId: string) => ({
      id, threadId: `thread-${id}`, internalDate: '1786550400000', labelIds: ['SENT'],
      payload: { headers: [
        { name: 'From', value: 'owner@example.com' }, { name: 'To', value: 'buyer@example.com' },
        { name: 'Message-ID', value: messageId },
      ] },
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'one' }, { id: 'two' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata('one', '<other@omnix.local>')), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata('two', '<a'.repeat(1) + '234567890123456@omnix.local>')), { status: 200 }));
    const client = new GoogleWorkspaceClient('access-token', fetcher);
    await expect(client.findSentMessageByClientMessageId('a234567890123456@omnix.local', 100))
      .resolves.toEqual({ messageId: 'two', threadId: 'thread-two' });
    const listUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(listUrl.searchParams.has('q')).toBe(false);
    expect(listUrl.searchParams.getAll('labelIds')).toEqual(['SENT']);
  });

  it('registers and stops Gmail watch and deletes only the Omnix event identity', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ historyId: '120', expiration: '1786636800000' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new GoogleWorkspaceClient('access-token', fetcher);
    await expect(client.watchGmail({ topicName: 'projects/omnix-prod/topics/gmail-push' }))
      .resolves.toMatchObject({ historyId: '120' });
    await expect(client.stopGmailWatch()).resolves.toBeUndefined();
    await expect(client.deleteOmnixCalendarEvent({ calendarId: 'omnix-calendar', eventId: 'event123' }))
      .resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/watch');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/stop');
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://www.googleapis.com/calendar/v3/calendars/omnix-calendar/events/event123');
  });

  it('detects an expired Calendar sync token without silently discarding it', async () => {
    const client = new GoogleWorkspaceClient('access-token', async () => new Response('{}', { status: 410 }));
    await expect(client.listOmnixCalendarEvents({ calendarId: 'calendar-a', syncToken: 'sync-token' }))
      .rejects.toMatchObject({ stream: 'calendar-events', code: 'conflict' });
  });
});
