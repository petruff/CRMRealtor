import { ConnectorError, sha256Hex } from './connector.ts';

export const TEXTING_CONSENT_STATUSES = ['unknown', 'opted_in', 'opted_out'] as const;
export type TextingConsentStatus = (typeof TEXTING_CONSENT_STATUSES)[number];

export const TEXTING_DELIVERY_STATES = [
  'draft', 'queued', 'accepted', 'sending', 'sent', 'delivered',
  'undelivered', 'failed', 'cancelled', 'received', 'review',
] as const;
export type TextingDeliveryState = (typeof TEXTING_DELIVERY_STATES)[number];

export const TWILIO_OPT_OUT_TYPES = ['STOP', 'START', 'HELP'] as const;
export type TwilioOptOutType = (typeof TWILIO_OPT_OUT_TYPES)[number];

export interface TextingQuietHoursPolicy {
  readonly startLocal: string;
  readonly endLocal: string;
  readonly recipientTimeZone: string;
  readonly policyVersion: string;
}

export interface TextingQuietHoursDecision {
  readonly allowed: boolean;
  readonly localMinute: number;
  readonly recipientTimeZone: string;
  readonly policyVersion: string;
  readonly reason: 'outside-quiet-hours' | 'inside-quiet-hours';
}

const DELIVERY_RANK: Readonly<Record<TextingDeliveryState, number>> = {
  draft: 0,
  queued: 10,
  accepted: 20,
  sending: 30,
  sent: 40,
  delivered: 60,
  undelivered: 60,
  failed: 60,
  cancelled: 60,
  received: 60,
  review: 60,
};

const TERMINAL_STATES = new Set<TextingDeliveryState>([
  'delivered', 'undelivered', 'failed', 'cancelled', 'received', 'review',
]);

function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', `${field} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u001f\u007f]/.test(clean)) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return clean;
}

export function parseE164Phone(value: unknown): string {
  const phone = cleanText(value, 'phone', 16);
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new ConnectorError('invalid-input', 'Texting requires an exact E.164 phone number.');
  }
  return phone;
}

export function textingPhoneHash(value: unknown): string {
  return sha256Hex(parseE164Phone(value));
}

export function parseTextingUseCase(value: unknown): string {
  const useCase = cleanText(value, 'useCase', 80);
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(useCase)) {
    throw new ConnectorError('invalid-input', 'Texting use case is invalid.');
  }
  return useCase;
}

export function parseTextMessageBody(value: unknown): string {
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', 'Message body is required.');
  const body = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (!body || body.length > 1_600 || /[\u0000\u007f]/.test(body)) {
    throw new ConnectorError('invalid-input', 'Message body must contain 1–1,600 safe characters.');
  }
  return body;
}

function parseClock(value: unknown, field: string): number {
  const clock = cleanText(value, field, 5);
  if (!/^\d{2}:\d{2}$/.test(clock)) throw new ConnectorError('invalid-input', `${field} is invalid.`);
  const [hour, minute] = clock.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour! > 23 || minute! > 59) {
    throw new ConnectorError('invalid-input', `${field} is invalid.`);
  }
  return hour! * 60 + minute!;
}

function localMinute(now: Date, timeZone: string): number {
  if (!Number.isFinite(now.getTime())) throw new ConnectorError('invalid-input', 'Quiet-hours instant is invalid.');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error('invalid');
    return hour * 60 + minute;
  } catch {
    throw new ConnectorError('invalid-input', 'A verified recipient timezone is required.');
  }
}

export function evaluateTextingQuietHours(
  policy: TextingQuietHoursPolicy,
  now = new Date(),
): TextingQuietHoursDecision {
  const start = parseClock(policy.startLocal, 'quietHoursStart');
  const end = parseClock(policy.endLocal, 'quietHoursEnd');
  const recipientTimeZone = cleanText(policy.recipientTimeZone, 'recipientTimeZone', 80);
  const policyVersion = cleanText(policy.policyVersion, 'policyVersion', 80);
  if (start === end) throw new ConnectorError('invalid-input', 'Quiet hours cannot span the entire day.');
  const minute = localMinute(now, recipientTimeZone);
  const inside = start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
  return {
    allowed: !inside,
    localMinute: minute,
    recipientTimeZone,
    policyVersion,
    reason: inside ? 'inside-quiet-hours' : 'outside-quiet-hours',
  };
}

export function nextAllowedTextingTime(
  policy: TextingQuietHoursPolicy,
  now = new Date(),
): Date {
  const initial = evaluateTextingQuietHours(policy, now);
  if (initial.allowed) return new Date(now);
  // Evaluate the actual IANA-zone wall clock rather than adding a local-clock
  // delta. That keeps scheduling correct across spring-forward/fall-back days.
  for (let minute = 1; minute <= 1_560; minute += 1) {
    const candidate = new Date(now.getTime() + minute * 60_000);
    if (evaluateTextingQuietHours(policy, candidate).allowed) return candidate;
  }
  throw new ConnectorError('conflict', 'A safe send time could not be resolved from the quiet-hours policy.');
}

export function parseTwilioOptOutType(value: unknown): TwilioOptOutType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ConnectorError('invalid-input', 'Twilio OptOutType is invalid.');
  const normalized = value.trim().toUpperCase();
  if (!TWILIO_OPT_OUT_TYPES.includes(normalized as TwilioOptOutType)) {
    throw new ConnectorError('invalid-input', 'Twilio OptOutType is unsupported.');
  }
  return normalized as TwilioOptOutType;
}

export function consentStatusForTwilioKeyword(
  keyword: TwilioOptOutType,
): TextingConsentStatus | undefined {
  if (keyword === 'STOP') return 'opted_out';
  if (keyword === 'START') return 'opted_in';
  return undefined;
}

export function canAdvanceTextingDeliveryState(
  current: TextingDeliveryState,
  next: TextingDeliveryState,
): boolean {
  if (current === next) return true;
  if (TERMINAL_STATES.has(current)) return false;
  return DELIVERY_RANK[next] >= DELIVERY_RANK[current];
}

export function assertTextingDeliveryTransition(
  current: TextingDeliveryState,
  next: TextingDeliveryState,
): void {
  if (!canAdvanceTextingDeliveryState(current, next)) {
    throw new ConnectorError('conflict', 'Texting delivery state cannot regress or replace a final outcome.');
  }
}

export function twilioStatusToDeliveryState(value: unknown): TextingDeliveryState {
  const status = cleanText(value, 'MessageStatus', 40).toLowerCase();
  const mapped: Readonly<Record<string, TextingDeliveryState>> = {
    accepted: 'accepted', queued: 'queued', scheduled: 'queued', sending: 'sending',
    sent: 'sent', delivered: 'delivered', undelivered: 'undelivered', failed: 'failed',
    canceled: 'cancelled', cancelled: 'cancelled', receiving: 'received', received: 'received', read: 'delivered',
  };
  const state = mapped[status];
  if (!state) throw new ConnectorError('invalid-input', 'Twilio message status is unsupported.');
  return state;
}
