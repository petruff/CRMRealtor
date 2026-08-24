import { describe, expect, it } from 'vitest';
import { connectionNotice, googleWorkspaceConnectHref, mailchimpConnectHref } from './oauth-presentation';

describe('connection OAuth presentation', () => {
  it('turns connector result codes into Judith-friendly language', () => {
    expect(connectionNotice({ success: 'google-workspace-core-connected' })).toMatchObject({
      tone: 'success', title: 'Google is connected',
    });
    expect(connectionNotice({ error: 'mailchimp-oauth-failed' })?.message).not.toContain('oauth');
    expect(connectionNotice({ success: 'google-workspace-core-partial' })).toMatchObject({
      tone: 'success', title: 'Google saved the permissions you approved',
    });
    expect(connectionNotice({ error: 'google-oauth-denied' })?.message).toContain('Nothing was changed');
    expect(connectionNotice({ error: 'mailchimp-setup-reconnect' })).toMatchObject({
      tone: 'warning', title: 'Reconnect Mailchimp to finish setup',
    });
  });

  it('creates one guided Google URL and a connection-bound Mailchimp reauthorization URL', () => {
    expect(googleWorkspaceConnectHref('google-a')).toBe(
      '/api/connectors/google/connect?bundle=workspace-core&connectionId=google-a',
    );
    expect(mailchimpConnectHref('mailchimp/a')).toBe(
      '/api/connectors/mailchimp/connect?connectionId=mailchimp%2Fa',
    );
  });
});
