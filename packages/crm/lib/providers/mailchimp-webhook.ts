import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import {
  mailchimpSubscriberHash,
  parseMailchimpWebhookEvent,
  type MailchimpSubscriptionStatus,
  type MailchimpWebhookEvent,
} from '../domain/mailchimp.ts';

const MAX_FORM_PAIRS = 128;
const MAX_VALUE_LENGTH = 2_048;

function value(form: URLSearchParams, key: string, max = MAX_VALUE_LENGTH): string | undefined {
  const values = form.getAll(key);
  if (values.length > 1) throw new ConnectorError('invalid-input', `Mailchimp ${key} is duplicated.`);
  const clean = values[0]?.trim();
  if (!clean) return undefined;
  if (clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('invalid-input', `Mailchimp ${key} is invalid.`);
  }
  return clean;
}

function status(type: string, action?: string): MailchimpSubscriptionStatus {
  if (type === 'subscribe') return 'subscribed';
  if (type === 'unsubscribe') return action === 'cleaned' ? 'cleaned' : 'unsubscribed';
  if (type === 'profile') return 'subscribed';
  if (type === 'cleaned') return 'cleaned';
  throw new ConnectorError('invalid-input', 'Mailchimp webhook type is not supported.');
}

function occurredAt(value: string): string {
  // Classic list webhooks document `YYYY-MM-DD HH:mm:ss` in UTC. Keep ISO input
  // for provider fixtures and reject locale-dependent or date-only values.
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook time is invalid.');
  }
  return parsed.toISOString();
}

/**
 * Parses the documented Mailchimp Marketing list-webhook form only after the
 * caller has authenticated the exact raw bytes. Unsupported event types fail
 * closed and no raw form data is returned.
 */
export function parseMailchimpMarketingWebhookForm(rawBody: Uint8Array): MailchimpWebhookEvent {
  if (!rawBody.byteLength || rawBody.byteLength > 1_048_576) {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook body size is invalid.');
  }
  let form: URLSearchParams;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    form = new URLSearchParams(decoded);
  } catch {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook form encoding is invalid.');
  }
  if ([...form].length > MAX_FORM_PAIRS) {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook form is too complex.');
  }
  const eventType = value(form, 'type', 32)?.toLowerCase();
  const audienceId = value(form, 'data[list_id]', 128);
  const email = value(form, 'data[email]', 320)?.toLowerCase();
  const memberId = value(form, 'data[id]', 128);
  const firedAt = value(form, 'fired_at', 64);
  if (!eventType || !audienceId || !email || !firedAt) {
    throw new ConnectorError('invalid-input', 'Mailchimp webhook fields are incomplete.');
  }
  const subscriptionStatus = status(eventType, value(form, 'data[action]', 32)?.toLowerCase());
  const providerEventMaterial = [eventType, firedAt, audienceId, memberId ?? mailchimpSubscriberHash(email)].join('|');
  return parseMailchimpWebhookEvent({
    eventId: sha256Hex(providerEventMaterial),
    audienceId,
    ...(memberId ? { memberId } : {}),
    normalizedEmail: email,
    subscriptionStatus,
    occurredAt: occurredAt(firedAt),
  });
}

