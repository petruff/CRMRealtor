import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import {
  parseE164Phone,
  parseTwilioOptOutType,
  twilioStatusToDeliveryState,
} from '../domain/texting.ts';
import { validateTwilioWebhook } from '../providers/twilio-client.ts';

export interface TwilioVerifiedWebhookEvent {
  readonly kind: 'inbound' | 'status';
  readonly accountSid: string;
  readonly messageSid: string;
  readonly from: string;
  readonly to: string;
  readonly phoneHash: string;
  readonly bodyHash?: string;
  readonly deliveryState?: string;
  readonly optOutType?: 'STOP' | 'START' | 'HELP';
  readonly eventHash: string;
  readonly rawBodyHash: string;
  readonly parametersHash: string;
  readonly externalUrlHash: string;
  readonly senderKeyHash: string;
  readonly providerOccurredAt: string;
  readonly errorCategory?: string;
  readonly body?: string;
}

function exactParameters(body: string): Record<string, string> {
  if (!body || Buffer.byteLength(body, 'utf8') > 1_048_576) {
    throw new ConnectorError('invalid-input', 'Twilio webhook payload is empty or oversized.');
  }
  const parsed = new URLSearchParams(body);
  const parameters: Record<string, string> = {};
  for (const [key, value] of parsed.entries()) {
    if (!key || key.length > 160 || value.length > 65_536 || key in parameters) {
      throw new ConnectorError('invalid-input', 'Twilio webhook parameters are invalid or duplicated.');
    }
    parameters[key] = value;
  }
  return parameters;
}

function required(parameters: Readonly<Record<string, string>>, field: string, pattern: RegExp): string {
  const value = parameters[field]?.trim() ?? '';
  if (!pattern.test(value)) throw new ConnectorError('invalid-input', `Twilio ${field} is invalid.`);
  return value;
}

export function verifyAndNormalizeTwilioWebhook(input: {
  readonly kind: 'inbound' | 'status';
  readonly rawBody: string;
  readonly signature: string;
  readonly externalUrl: string;
  readonly authToken: string;
  readonly receivedAt?: string;
}): TwilioVerifiedWebhookEvent {
  const parameters = exactParameters(input.rawBody);
  if (!validateTwilioWebhook({
    authToken: input.authToken,
    signature: input.signature,
    externalUrl: input.externalUrl,
    parameters,
  })) throw new ConnectorError('forbidden', 'Twilio webhook signature verification failed.');
  const accountSid = required(parameters, 'AccountSid', /^AC[A-Fa-f0-9]{32}$/);
  const messageSid = required(parameters, 'MessageSid', /^SM[A-Fa-f0-9]{32}$/);
  const from = parseE164Phone(required(parameters, 'From', /^\+[1-9]\d{6,14}$/));
  const to = parseE164Phone(required(parameters, 'To', /^\+[1-9]\d{6,14}$/));
  const fallbackReceivedAt = input.receivedAt ?? new Date().toISOString();
  const providerOccurredAt = new Date(parameters.DateCreated ?? parameters.Timestamp ?? fallbackReceivedAt).toISOString();
  const common = {
    rawBodyHash: sha256Hex(input.rawBody),
    parametersHash: stablePayloadHash(parameters),
    externalUrlHash: sha256Hex(input.externalUrl),
    senderKeyHash: sha256Hex(input.kind === 'inbound' ? to : from),
    providerOccurredAt,
  };
  if (input.kind === 'status') {
    const deliveryState = twilioStatusToDeliveryState(parameters.MessageStatus ?? parameters.SmsStatus);
    return {
      kind: 'status', accountSid, messageSid, from, to,
      phoneHash: sha256Hex(to), deliveryState, ...common,
      ...(parameters.ErrorCode ? { errorCategory: 'provider_delivery_error' } : {}),
      eventHash: stablePayloadHash({ accountSid, messageSid, deliveryState, fromHash: sha256Hex(from), toHash: sha256Hex(to) }),
    };
  }
  const body = parameters.Body ?? '';
  if (body.length > 1_600 || /[\u0000\u007f]/.test(body)) {
    throw new ConnectorError('invalid-input', 'Twilio inbound content is invalid.');
  }
  const optOutType = parseTwilioOptOutType(parameters.OptOutType);
  return {
    kind: 'inbound', accountSid, messageSid, from, to,
    phoneHash: sha256Hex(from), bodyHash: sha256Hex(body), body, ...common,
    ...(optOutType ? { optOutType } : {}),
    eventHash: stablePayloadHash({
      accountSid, messageSid, fromHash: sha256Hex(from), toHash: sha256Hex(to), bodyHash: sha256Hex(body), optOutType,
    }),
  };
}
