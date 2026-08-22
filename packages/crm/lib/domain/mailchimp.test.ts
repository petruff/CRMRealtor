import { describe, expect, it } from 'vitest';
import {
  createMailchimpAccountIdentity,
  createMailchimpMemberOperation,
  isMailchimpOutboundEcho,
  mailchimpSubscriberHash,
  parseMailchimpAudience,
  parseMailchimpWebhookEvent,
} from './mailchimp';

describe('Mailchimp provider contract', () => {
  it('pins the API base to verified OAuth metadata data-center identity', () => {
    expect(createMailchimpAccountIdentity({ accountId: 'account-a', accountName: 'Realtor', dataCenter: 'US21' }))
      .toMatchObject({ dataCenter: 'us21', apiBaseUrl: 'https://us21.api.mailchimp.com/3.0' });
    expect(() => createMailchimpAccountIdentity({
      accountId: 'account-a', accountName: 'Realtor', dataCenter: 'evil.example.com/path',
    })).toThrow(/data center is invalid/i);
  });

  it('creates deterministic one-audience tag operations without retaining email', () => {
    const operation = createMailchimpMemberOperation({
      audienceId: 'audience-a', normalizedEmail: ' Realtor@Example.com ', leadType: 'hot',
    });
    expect(operation).toMatchObject({
      audienceId: 'audience-a', desiredTag: 'Omnix: Hot', mappingVersion: 1,
      subscriberHash: mailchimpSubscriberHash('realtor@example.com'),
    });
    expect(JSON.stringify(operation)).not.toContain('realtor@example.com');
    expect(operation.subscriberHash).toBe('8822d5a5eb2504f0b5c398dbdd306ea4');
  });

  it('validates selected audiences and normalizes subscription events', () => {
    expect(parseMailchimpAudience({ id: 'audience-a', name: 'Primary clients', memberCount: 220 }))
      .toEqual({ id: 'audience-a', name: 'Primary clients', memberCount: 220 });
    const event = parseMailchimpWebhookEvent({
      eventId: 'event-a', audienceId: 'audience-a', normalizedEmail: 'Buyer@Example.com',
      subscriptionStatus: 'unsubscribed', occurredAt: '2026-08-11T12:00:00-04:00',
    });
    expect(event).toMatchObject({
      normalizedEmail: 'buyer@example.com', subscriptionStatus: 'unsubscribed', origin: 'mailchimp-webhook',
    });
  });

  it('suppresses only an exact same-audience outbound echo', () => {
    const event = parseMailchimpWebhookEvent({
      eventId: 'event-a', audienceId: 'audience-a', normalizedEmail: 'buyer@example.com',
      subscriptionStatus: 'subscribed', occurredAt: '2026-08-11T16:00:00Z',
    });
    expect(isMailchimpOutboundEcho({
      event, selectedAudienceId: 'audience-a', originatingOperationKey: 'same', observedOperationKey: 'same',
    })).toBe(true);
    expect(isMailchimpOutboundEcho({
      event, selectedAudienceId: 'audience-b', originatingOperationKey: 'same', observedOperationKey: 'same',
    })).toBe(false);
  });
});
