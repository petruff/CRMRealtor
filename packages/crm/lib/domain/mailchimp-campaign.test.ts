import { describe, expect, it } from 'vitest';
import { mailchimpSubscriberHash, type MailchimpAudienceMember } from './mailchimp';
import { mailchimpProviderCampaignTitle, mailchimpSegmentOptions, parseMailchimpCampaignContent,
  previewMailchimpCampaign } from './mailchimp-campaign';

const content = {
  title: 'August update', subject: 'A quick real estate update', previewText: 'Local news and one useful idea',
  fromName: 'Judith Serna', replyTo: 'judith@example.com', html: '<p>Hello</p>', plainText: 'Hello',
};

function member(email: string, status: MailchimpAudienceMember['subscriptionStatus']): MailchimpAudienceMember {
  return { memberId: email, subscriberHash: mailchimpSubscriberHash(email), normalizedEmail: email,
    subscriptionStatus: status, lastChangedAt: '2026-08-27T12:00:00.000Z' };
}

describe('governed Mailchimp campaign contracts', () => {
  it('includes only unique subscribed members and counts every ineligible provider state', () => {
    const subscribed = member('subscribed@example.com', 'subscribed');
    const preview = previewMailchimpCampaign({ audienceId: 'audience-a', audienceName: 'Judith Serna Realtor',
      segment: { kind: 'all-subscribers' }, content, asOf: '2026-08-27T12:00:00.000Z',
      members: [subscribed, subscribed, member('out@example.com', 'unsubscribed'), member('clean@example.com', 'cleaned'),
        member('wait@example.com', 'pending'), member('archive@example.com', 'archived'), member('transaction@example.com', 'transactional')] });
    expect(preview).toMatchObject({ eligibleCount: 1, excluded: {
      duplicate: 1, unsubscribed: 1, cleaned: 1, pending: 1, archived: 1, nonSubscribed: 1,
    } });
    expect(preview.recipientSnapshotHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('previews a lead-temperature segment from existing Omnix tags without exposing emails', () => {
    const hot = member('hot@example.com', 'subscribed');
    const warm = member('warm@example.com', 'subscribed');
    const preview = previewMailchimpCampaign({ audienceId: 'audience-a', audienceName: 'Audience',
      segment: { kind: 'lead-type', value: 'hot' }, content, members: [hot, warm],
      memberTagNames: { [hot.subscriberHash]: ['Omnix: Hot'], [warm.subscriberHash]: ['Omnix: Warm'] },
      asOf: '2026-08-27T12:00:00.000Z' });
    expect(preview.eligibleCount).toBe(1);
    expect(JSON.stringify(preview)).not.toContain('@example.com');
    expect(mailchimpSegmentOptions({ kind: 'lead-type', value: 'hot' })).toMatchObject({
      tagName: 'Omnix: Hot',
    });
  });

  it('rejects malformed addresses, controls and oversized campaign fields', () => {
    expect(() => parseMailchimpCampaignContent({ ...content, replyTo: 'not-an-email' })).toThrow(/replyTo is invalid/u);
    expect(() => parseMailchimpCampaignContent({ ...content, subject: 'bad\nsubject' })).toThrow(/subject is invalid/u);
  });

  it('creates a bounded unique provider title for crash-safe draft recovery', () => {
    const title = mailchimpProviderCampaignTitle({ id: '12345678-aaaa-bbbb-cccc-123456789012', content: {
      ...content, title: 'A'.repeat(160),
    } });
    expect(title).toHaveLength(160);
    expect(title).toMatch(/\[Omnix 12345678\]$/u);
  });
});
