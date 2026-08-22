import { describe, expect, it } from 'vitest';
import { parseMailchimpMarketingWebhookForm } from './mailchimp-webhook';

function form(entries: Record<string, string>): Uint8Array {
  return Buffer.from(new URLSearchParams(entries).toString());
}

describe('Mailchimp Marketing webhook form', () => {
  it('normalizes the documented subscribe form without returning the raw body', () => {
    const event = parseMailchimpMarketingWebhookForm(form({
      type: 'subscribe', fired_at: '2026-08-11 12:00:00',
      'data[id]': 'member-a', 'data[list_id]': 'audience-a',
      'data[email]': 'Buyer@Example.com',
    }));
    expect(event).toMatchObject({
      audienceId: 'audience-a', memberId: 'member-a',
      normalizedEmail: 'buyer@example.com', subscriptionStatus: 'subscribed',
      occurredAt: '2026-08-11T12:00:00.000Z', origin: 'mailchimp-webhook',
    });
    expect(event.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain('fired_at');
  });

  it('maps unsubscribe and rejects unsupported or ambiguous forms', () => {
    expect(parseMailchimpMarketingWebhookForm(form({
      type: 'unsubscribe', fired_at: '2026-08-11 12:00:00',
      'data[id]': 'member-a', 'data[list_id]': 'audience-a',
      'data[email]': 'buyer@example.com',
    }))).toMatchObject({ subscriptionStatus: 'unsubscribed' });
    expect(() => parseMailchimpMarketingWebhookForm(form({
      type: 'campaign', fired_at: '2026-08-11 12:00:00',
      'data[list_id]': 'audience-a', 'data[email]': 'buyer@example.com',
    }))).toThrow(/not supported/i);
    expect(() => parseMailchimpMarketingWebhookForm(Buffer.from(
      'type=subscribe&type=unsubscribe&fired_at=2026-08-11+12%3A00%3A00&data%5Blist_id%5D=a&data%5Bemail%5D=a%40b.com',
    ))).toThrow(/duplicated/i);
  });
});
