import { ConnectorError, sha256Hex } from '../domain/connector.ts';

export interface GoogleGmailPushConfiguration {
  readonly topicName: string;
  readonly subscriptionName: string;
  readonly audience: string;
  readonly serviceAccountEmail: string;
  readonly endpointKey: string;
  readonly externalUrl: string;
  readonly endpointKeyHash: string;
  readonly exactExternalUrlHash: string;
  readonly subscriptionHash: string;
  readonly oidcAudienceHash: string;
}

const GOOGLE_GMAIL_PUSH_ENVIRONMENT_KEYS = [
  'GOOGLE_GMAIL_PUBSUB_TOPIC',
  'GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION',
  'GOOGLE_GMAIL_PUSH_AUDIENCE',
  'GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_GMAIL_PUSH_ENDPOINT_KEY',
  'GOOGLE_GMAIL_PUSH_EXTERNAL_URL',
] as const;

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name]?.trim();
  if (!value || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return value;
}

export function loadGoogleGmailPushConfiguration(
  environment: Record<string, string | undefined> = process.env,
): GoogleGmailPushConfiguration {
  const topicName = required(environment, 'GOOGLE_GMAIL_PUBSUB_TOPIC');
  const subscriptionName = required(environment, 'GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION');
  const audience = required(environment, 'GOOGLE_GMAIL_PUSH_AUDIENCE');
  const serviceAccountEmail = required(environment, 'GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT_EMAIL').toLowerCase();
  const endpointKey = required(environment, 'GOOGLE_GMAIL_PUSH_ENDPOINT_KEY');
  const externalUrl = required(environment, 'GOOGLE_GMAIL_PUSH_EXTERNAL_URL');
  if (!/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/.test(topicName)
    || !/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/subscriptions\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/.test(subscriptionName)
    || !/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(serviceAccountEmail)
    || !/^[A-Za-z0-9_-]{32,256}$/.test(endpointKey)) {
    throw new ConnectorError('configuration-required', 'Google Gmail Pub/Sub binding is invalid.');
  }
  let parsed: URL;
  try { parsed = new URL(externalUrl); } catch {
    throw new ConnectorError('configuration-required', 'GOOGLE_GMAIL_PUSH_EXTERNAL_URL is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname !== `/api/connectors/google/gmail/push/${endpointKey}`
    || audience !== parsed.toString()) {
    throw new ConnectorError('configuration-required',
      'Google Gmail push URL and OIDC audience must be the same fixed HTTPS endpoint.');
  }
  return {
    topicName, subscriptionName, audience, serviceAccountEmail, endpointKey,
    externalUrl: parsed.toString(), endpointKeyHash: sha256Hex(endpointKey),
    exactExternalUrlHash: sha256Hex(parsed.toString()), subscriptionHash: sha256Hex(subscriptionName),
    oidcAudienceHash: sha256Hex(audience),
  };
}

export function loadOptionalGoogleGmailPushConfiguration(
  environment: Record<string, string | undefined> = process.env,
): GoogleGmailPushConfiguration | undefined {
  const configured = GOOGLE_GMAIL_PUSH_ENVIRONMENT_KEYS.filter((key) => environment[key]?.trim());
  if (configured.length === 0) return undefined;
  return loadGoogleGmailPushConfiguration(environment);
}
