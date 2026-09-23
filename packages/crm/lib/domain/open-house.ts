import type { Intent, LeadType } from './contact.ts';

/**
 * Open house sign-in.
 *
 * Consent is opt-in and unchecked by default; the exact wording and its
 * version are stored with the visitor so the realtor can show what was agreed
 * to (TCPA "prior express written consent" for marketing texts). Visitors who
 * already work with an agent are marked so they are not solicited (NAR Code of
 * Ethics, Article 16).
 */

export const OPEN_HOUSE_CONSENT_VERSION = 'omnix.open-house-consent.v1';
export const OPEN_HOUSE_SMS_CONSENT_TEXT =
  'Yes, text me about this home and similar listings. Message and data rates may apply; message frequency varies. Reply STOP to opt out. Consent is not a condition of purchase.';
export const OPEN_HOUSE_EMAIL_CONSENT_TEXT = 'Yes, email me about this home and similar listings. I can unsubscribe at any time.';

export const OPEN_HOUSE_TIMEFRAMES = ['now', '3-months', '6-months', 'later', 'just-looking'] as const;
export type OpenHouseTimeframe = (typeof OPEN_HOUSE_TIMEFRAMES)[number];
export const OPEN_HOUSE_TIMEFRAME_LABEL: Record<OpenHouseTimeframe, string> = {
  now: 'Ready now',
  '3-months': 'Within 3 months',
  '6-months': 'Within 6 months',
  later: 'Later this year or next',
  'just-looking': 'Just looking',
};

export interface OpenHouseSignIn {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone?: string;
  readonly phoneDigits?: string;
  readonly email?: string;
  readonly intent: Intent;
  readonly timeframe: OpenHouseTimeframe;
  readonly hasAgent: boolean;
  readonly smsConsent: boolean;
  readonly emailConsent: boolean;
  readonly comments?: string;
}

export class OpenHouseError extends Error {
  readonly fieldErrors: Readonly<Record<string, string>>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'OpenHouseError';
    this.fieldErrors = fieldErrors;
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/u;

function field(form: FormData, key: string, max: number, errors: Record<string, string>): string {
  const raw = form.get(key);
  if (typeof raw !== 'string') return '';
  const value = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (value.length > max || CONTROL.test(value)) {
    errors[key] = `Keep this under ${max} characters.`;
    return '';
  }
  return value;
}

export function validateOpenHouseProperty(value: unknown): string {
  const property = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  if (property.length < 3 || property.length > 160 || CONTROL.test(property)) {
    throw new OpenHouseError('Enter the open house address.', { property: 'Use 3–160 characters.' });
  }
  return property;
}

export function parseOpenHouseSignIn(form: FormData): OpenHouseSignIn {
  const errors: Record<string, string> = {};
  const firstName = field(form, 'firstName', 80, errors);
  const lastName = field(form, 'lastName', 80, errors);
  const phone = field(form, 'phone', 40, errors);
  const email = field(form, 'email', 254, errors).toLowerCase();
  const comments = field(form, 'comments', 500, errors);
  if (!firstName && !errors.firstName) errors.firstName = 'Please add your first name.';
  if (!lastName && !errors.lastName) errors.lastName = 'Please add your last name.';
  let phoneDigits: string | undefined;
  if (phone) {
    phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length === 11 && phoneDigits.startsWith('1')) phoneDigits = phoneDigits.slice(1);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) errors.phone = 'Use a 10-digit phone number.';
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) errors.email = 'That email doesn’t look right.';
  if (!phone && !email && !errors.phone && !errors.email) errors.phone = 'Add a phone number or an email so the agent can follow up.';
  const intentRaw = String(form.get('intent') ?? 'buyer');
  const intent: Intent = (['buyer', 'seller', 'both', 'renter', 'investor'] as const).includes(intentRaw as never) ? intentRaw as Intent : 'unknown';
  const timeframeRaw = String(form.get('timeframe') ?? 'just-looking');
  const timeframe = (OPEN_HOUSE_TIMEFRAMES as readonly string[]).includes(timeframeRaw) ? timeframeRaw as OpenHouseTimeframe : 'just-looking';
  const smsConsent = form.get('smsConsent') === 'on';
  if (smsConsent && !phone) errors.smsConsent = 'Add a phone number to receive texts.';
  const emailConsent = form.get('emailConsent') === 'on';
  if (emailConsent && !email) errors.emailConsent = 'Add an email to receive updates.';
  if (Object.keys(errors).length) throw new OpenHouseError('Please check the highlighted fields.', errors);
  return {
    firstName, lastName,
    ...(phone ? { phone, phoneDigits } : {}),
    ...(email ? { email } : {}),
    intent, timeframe,
    hasAgent: form.get('hasAgent') === 'yes',
    smsConsent, emailConsent,
    ...(comments ? { comments } : {}),
  };
}

/** Temperature from what the visitor told us — never from who they are. */
export function openHouseLeadType(signIn: Pick<OpenHouseSignIn, 'hasAgent' | 'timeframe'>): LeadType {
  if (signIn.hasAgent || signIn.timeframe === 'just-looking' || signIn.timeframe === 'later') return 'nurture';
  if (signIn.timeframe === 'now' || signIn.timeframe === '3-months') return 'hot';
  return 'warm';
}

export function openHouseTag(propertyAddress: string, day: string): string {
  const slug = propertyAddress.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `open-house:${day}:${slug}`;
}

export function openHouseNote(signIn: OpenHouseSignIn, propertyAddress: string, occurredAt: string): string {
  const lines = [
    `Signed in at the open house for ${propertyAddress}.`,
    `Looking to: ${signIn.intent === 'unknown' ? 'not sure yet' : signIn.intent} · Timeframe: ${OPEN_HOUSE_TIMEFRAME_LABEL[signIn.timeframe]}`,
    signIn.hasAgent ? 'Already working with an agent — do not solicit (NAR Code of Ethics, Article 16).' : 'Not working with an agent.',
    `Text consent: ${signIn.smsConsent ? 'granted' : 'not given'} · Email consent: ${signIn.emailConsent ? 'granted' : 'not given'} · ${OPEN_HOUSE_CONSENT_VERSION} at ${occurredAt}`,
  ];
  if (signIn.smsConsent) lines.push(`Text consent wording: "${OPEN_HOUSE_SMS_CONSENT_TEXT}"`);
  if (signIn.comments) lines.push(`Visitor comments: ${signIn.comments}`);
  return lines.join('\n');
}
