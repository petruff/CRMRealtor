import { describe, expect, it } from 'vitest';
import {
  googleRequestedScopes,
  normalizeGoogleGrantedScopes,
  parseGoogleAccountIdentity,
  parseGoogleFeatureBundle,
  createGoogleRawTextMessage,
  normalizeSingleGoogleMailbox,
} from './google-connector';

describe('Google connector domain', () => {
  it('keeps identity and feature scopes incremental and explicit', () => {
    expect(googleRequestedScopes('gmail-send')).toEqual([
      'openid', 'email', 'https://www.googleapis.com/auth/gmail.send',
    ]);
    expect(googleRequestedScopes('calendar-app-created')).not.toContain('https://www.googleapis.com/auth/calendar.events');
    expect(() => parseGoogleFeatureBundle('gmail.readonly')).toThrow(/bundle is invalid/i);
    expect(normalizeGoogleGrantedScopes([
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/gmail.send',
    ])).toEqual(['email', 'https://www.googleapis.com/auth/gmail.send', 'openid']);
  });

  it('builds a bounded plain-text Gmail message without header injection', () => {
    const raw = createGoogleRawTextMessage({
      from: 'Realtor <owner@example.com>', to: 'buyer@example.com',
      subject: 'Showing confirmation', body: 'See you tomorrow.',
      clientMessageId: '0123456789abcdef@omnix.local',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    expect(decoded).toContain('From: owner@example.com\r\nTo: buyer@example.com');
    expect(decoded).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(decoded).toContain('Message-ID: <0123456789abcdef@omnix.local>');
    expect(() => createGoogleRawTextMessage({
      from: 'owner@example.com', to: 'buyer@example.com', subject: 'Hello\r\nBcc: leak@example.com', body: 'No',
    })).toThrow(/content is invalid/i);
    expect(() => normalizeSingleGoogleMailbox('a@example.com, b@example.com')).toThrow(/requires review/i);
  });

  it('accepts only verified provider identities', () => {
    expect(parseGoogleAccountIdentity({ sub: 'google-user-1', email: 'Owner@Example.com', email_verified: true }))
      .toEqual({ subject: 'google-user-1', email: 'owner@example.com', displayLabel: 'owner@example.com' });
    expect(() => parseGoogleAccountIdentity({ sub: 'google-user-1', email: 'owner@example.com', email_verified: false }))
      .toThrow(/unverified/i);
  });
});
