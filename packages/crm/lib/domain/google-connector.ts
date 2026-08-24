import { ConnectorError } from './connector.ts';

export const GOOGLE_FEATURE_BUNDLES = [
  'workspace-core',
  'gmail-send',
  'gmail-metadata',
  'calendar-app-created',
] as const;

export type GoogleFeatureBundle = (typeof GOOGLE_FEATURE_BUNDLES)[number];

export const GOOGLE_IDENTITY_SCOPES = [
  'openid',
  'email',
] as const;

const GOOGLE_EMAIL_SCOPE_ALIASES = [
  'email',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

const GOOGLE_SCOPE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  email: GOOGLE_EMAIL_SCOPE_ALIASES,
};

export function isGoogleScopeGranted(
  grantedScopes: readonly string[],
  requestedScope: string,
): boolean {
  return (GOOGLE_SCOPE_ALIASES[requestedScope] ?? [requestedScope])
    .some((scope) => grantedScopes.includes(scope));
}

export function normalizeGoogleGrantedScopes(grantedScopes: readonly string[]): readonly string[] {
  return [...new Set(grantedScopes.map((scope) => (
    GOOGLE_EMAIL_SCOPE_ALIASES.includes(scope as (typeof GOOGLE_EMAIL_SCOPE_ALIASES)[number]) ? 'email' : scope
  )))].sort();
}

export const GOOGLE_BUNDLE_SCOPES: Readonly<Record<GoogleFeatureBundle, readonly string[]>> = {
  'workspace-core': [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/calendar.app.created',
  ],
  'gmail-send': ['https://www.googleapis.com/auth/gmail.send'],
  'gmail-metadata': ['https://www.googleapis.com/auth/gmail.metadata'],
  'calendar-app-created': ['https://www.googleapis.com/auth/calendar.app.created'],
};

export const GOOGLE_ACTION_REQUIRED_SCOPE = {
  'gmail.send': GOOGLE_BUNDLE_SCOPES['gmail-send'][0],
  'gmail.sync-metadata': GOOGLE_BUNDLE_SCOPES['gmail-metadata'][0],
  'calendar.create-omnix-calendar': GOOGLE_BUNDLE_SCOPES['calendar-app-created'][0],
  'calendar.upsert-omnix-event': GOOGLE_BUNDLE_SCOPES['calendar-app-created'][0],
  'calendar.complete-omnix-event': GOOGLE_BUNDLE_SCOPES['calendar-app-created'][0],
  'calendar.cancel-omnix-event': GOOGLE_BUNDLE_SCOPES['calendar-app-created'][0],
  'calendar.delete-omnix-event': GOOGLE_BUNDLE_SCOPES['calendar-app-created'][0],
  'calendar.sync': GOOGLE_BUNDLE_SCOPES['calendar-app-created'][0],
} as const;

export type GoogleConnectorAction = keyof typeof GOOGLE_ACTION_REQUIRED_SCOPE;

export function googleRequiredScopeForAction(action: string): string | undefined {
  return GOOGLE_ACTION_REQUIRED_SCOPE[action as GoogleConnectorAction];
}

export interface GoogleAccountIdentity {
  readonly subject: string;
  readonly email: string;
  readonly displayLabel: string;
}

export interface GoogleGmailMetadataMessage {
  readonly messageId: string;
  readonly threadId: string;
  readonly internalDate: string;
  readonly labels: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly messageIdHeader?: string;
}

export function normalizeSingleGoogleMailbox(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 998
    || /[\r\n\u0000-\u001f\u007f]/.test(value)) {
    throw new ConnectorError('invalid-input', 'Google mailbox header is invalid.');
  }
  const clean = value.trim();
  if (clean.includes(',') || clean.includes(';') || /:\s*.*;/.test(clean)) {
    throw new ConnectorError('conflict', 'Group or multi-address Gmail metadata requires review.');
  }
  const angle = /<([^<>]+)>$/.exec(clean);
  const email = (angle?.[1] ?? clean).trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    throw new ConnectorError('conflict', 'Gmail metadata address requires review.');
  }
  return email;
}

export function createGoogleRawTextMessage(input: {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly clientMessageId?: string;
}): string {
  const from = normalizeSingleGoogleMailbox(input.from);
  const to = normalizeSingleGoogleMailbox(input.to);
  const subject = input.subject.trim();
  const body = input.body.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (!subject || subject.length > 200 || /[\r\n\u0000-\u001f\u007f]/.test(subject)
    || !body.trim() || body.length > 50_000 || /[\u0000\u007f]/.test(body)) {
    throw new ConnectorError('invalid-input', 'Google email content is invalid.');
  }
  const messageId = input.clientMessageId?.trim();
  if (messageId !== undefined && !/^[a-z0-9._-]{16,128}@[a-z0-9.-]{3,120}$/.test(messageId)) {
    throw new ConnectorError('invalid-input', 'Google email reconciliation key is invalid.');
  }
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    ...(messageId ? [`Message-ID: <${messageId}>`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export function parseGoogleFeatureBundle(value: unknown): GoogleFeatureBundle {
  if (typeof value !== 'string' || !GOOGLE_FEATURE_BUNDLES.includes(value as GoogleFeatureBundle)) {
    throw new ConnectorError('invalid-input', 'Google feature bundle is invalid.');
  }
  return value as GoogleFeatureBundle;
}

export function googleRequestedScopes(bundle: GoogleFeatureBundle): readonly string[] {
  return [...GOOGLE_IDENTITY_SCOPES, ...GOOGLE_BUNDLE_SCOPES[bundle]];
}

export function parseGoogleAccountIdentity(value: unknown): GoogleAccountIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectorError('provider-disabled', 'Google account identity is invalid.');
  }
  const row = value as Record<string, unknown>;
  const subject = typeof row.sub === 'string' ? row.sub.trim() : '';
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
  const emailVerified = row.email_verified === true;
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(subject) || !emailVerified
    || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConnectorError('provider-disabled', 'Google returned an unverified account identity.');
  }
  return { subject, email, displayLabel: email };
}
