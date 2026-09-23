import type { Intent } from './contact.ts';
import type { WebsiteIntakeAction, WebsiteLeadPayload } from './website-intake.ts';

/**
 * The hosted Omnix lead page ("Let's talk"): a public, branded form the
 * realtor shares as a link or QR code. Consent is opt-in and versioned; the
 * submission flows through the same website intake pipeline as a signed site.
 */

export const LEAD_PAGE_KEY_PREFIX = 'lead-page-';
export const LEAD_PAGE_FORM_ID = 'omnix-lead-page';
export const LEAD_PAGE_CONSENT_VERSION = 'omnix.lead-page-consent.v1';
export const LEAD_PAGE_SMS_CONSENT_TEXT =
  'Yes, you may text me about my request and homes that fit. Message and data rates may apply; message frequency varies. Reply STOP to opt out. Consent is not a condition of purchase.';
export const LEAD_PAGE_EMAIL_CONSENT_TEXT = 'Yes, email me about my request and homes that fit. I can unsubscribe at any time.';

export const LEAD_PAGE_HELP = [
  { value: 'general-inquiry', label: 'I have a question' },
  { value: 'showing-request', label: 'I’d like to see a home' },
  { value: 'seller-consultation', label: 'What’s my home worth?' },
] as const satisfies readonly { value: WebsiteIntakeAction; label: string }[];

export const LEAD_PAGE_TIMEFRAMES = [
  { value: 'now', label: 'Ready now', days: 14 },
  { value: '3-months', label: 'Within 3 months', days: 90 },
  { value: '6-months', label: 'Within 6 months', days: 180 },
  { value: 'later', label: 'Later', days: 365 },
  { value: 'just-looking', label: 'Just exploring', days: undefined },
] as const;

export const LEAD_PAGE_INTENTS = [
  { value: 'buyer', label: 'Buy' },
  { value: 'seller', label: 'Sell' },
  { value: 'both', label: 'Buy & sell' },
  { value: 'renter', label: 'Rent' },
  { value: 'investor', label: 'Invest' },
] as const;

export class LeadPageError extends Error {
  readonly fieldErrors: Readonly<Record<string, string>>;
  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'LeadPageError';
    this.fieldErrors = fieldErrors;
  }
}

export function isLeadPageKey(value: string): boolean {
  return /^lead-page-[a-z0-9]{10,40}$/u.test(value);
}

const GENERIC_NAME_WORDS = new Set(['your', 'the', 'my', 'our', 'omnix', 'workspace', 'team']);

/** "Judith's Workspace" → "Judith"; generic names fall back to "your agent". */
export function agentFirstName(name: string): string {
  const first = name.replace(/,.*$/u, '').trim().split(/\s+/u)[0]?.replace(/['’]s$/u, '') ?? '';
  return first && !GENERIC_NAME_WORDS.has(first.toLowerCase()) && /\p{L}/u.test(first) ? first : 'your agent';
}

/** Only short, known source tags from the shared link (e.g. ?src=instagram) are kept. */
export function leadPageSource(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9-]{2,30}$/u.test(raw) ? raw : 'lead-page';
}

const CONTROL = /[\u0000-\u001f\u007f]/u;

function field(form: FormData, key: string, max: number, errors: Record<string, string>): string {
  const raw = form.get(key);
  if (typeof raw !== 'string') return '';
  const value = raw.normalize('NFKC').trim().replace(/[ \t]+/g, ' ');
  if (value.length > max || CONTROL.test(value.replace(/\n/g, ' '))) { errors[key] = `Keep this under ${max} characters.`; return ''; }
  return value;
}

/** Turns the public form into the website-intake payload (validated again downstream). */
export function leadPagePayload(form: FormData, input: { readonly submissionId: string; readonly landingPage: string; readonly source: string; readonly referrer?: string }): WebsiteLeadPayload {
  const errors: Record<string, string> = {};
  const firstName = field(form, 'firstName', 100, errors);
  const lastName = field(form, 'lastName', 100, errors);
  const phone = field(form, 'phone', 40, errors);
  const email = field(form, 'email', 254, errors).toLowerCase();
  const message = field(form, 'message', 1500, errors);
  if (!firstName && !errors.firstName) errors.firstName = 'Please add your first name.';
  if (!lastName && !errors.lastName) errors.lastName = 'Please add your last name.';
  const digits = phone.replace(/\D/g, '');
  if (phone && (digits.length < 10 || digits.length > 15)) errors.phone = 'Use a 10-digit phone number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) errors.email = 'That email doesn’t look right.';
  if (!phone && !email && !errors.phone && !errors.email) errors.phone = 'Add a phone number or an email so we can reach you.';
  const smsConsent = form.get('smsConsent') === 'on';
  const emailConsent = form.get('emailConsent') === 'on';
  if (smsConsent && !phone) errors.smsConsent = 'Add a phone number to receive texts.';
  if (emailConsent && !email) errors.emailConsent = 'Add an email to receive updates.';
  if (Object.keys(errors).length) throw new LeadPageError('Please check the highlighted fields.', errors);
  const intentRaw = String(form.get('intent') ?? '');
  const intent: Intent = LEAD_PAGE_INTENTS.some((item) => item.value === intentRaw) ? intentRaw as Intent : 'unknown';
  const helpRaw = String(form.get('help') ?? 'general-inquiry');
  const requestedAction: WebsiteIntakeAction = LEAD_PAGE_HELP.find((item) => item.value === helpRaw)?.value ?? 'general-inquiry';
  const timeframe = LEAD_PAGE_TIMEFRAMES.find((item) => item.value === String(form.get('timeframe') ?? ''));
  return {
    submissionId: input.submissionId,
    firstName, lastName,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    intent, requestedAction,
    ...(timeframe?.days !== undefined ? { timelineDays: timeframe.days } : {}),
    ...(message ? { message } : {}),
    attribution: {
      source: input.source,
      medium: 'lead-page',
      formId: LEAD_PAGE_FORM_ID,
      landingPage: input.landingPage,
      ...(input.referrer ? { referrer: input.referrer } : {}),
    },
    consent: {
      email: emailConsent ? 'granted' : 'declined',
      sms: smsConsent ? 'granted' : 'declined',
      phone: 'unknown',
      policyVersion: LEAD_PAGE_CONSENT_VERSION,
    },
  };
}
