import {
  CONNECTOR_PROVIDERS,
  ConnectorError,
  type ConnectorDefinition,
  type ConnectorProvider,
} from '../domain/connector.ts';

export interface ConnectorRuntimeConfiguration {
  readonly worker: {
    readonly route: '/api/internal/connectors/drain';
    readonly batchSize: number;
    readonly leaseSeconds: number;
    readonly maxRuntimeSeconds: number;
    readonly reconciliationBatchSize: number;
  };
  readonly retry: {
    readonly maxAttempts: number;
    readonly baseDelaySeconds: number;
    readonly maxDelaySeconds: number;
  };
  readonly definitions: readonly ConnectorDefinition[];
}

const DEFINITIONS: readonly ConnectorDefinition[] = [
  {
    provider: 'contract-test',
    label: 'Contract test adapter',
    mode: 'contract-test',
    enabled: true,
    capabilities: ['test.succeed', 'test.ambiguous', 'test.retryable', 'test.fail'],
    productionRequirements: ['Never enable as a real provider'],
  },
  {
    provider: 'google',
    label: 'Gmail & Google Calendar',
    mode: 'provider-disabled',
    enabled: false,
    capabilities: [
      'gmail.send',
      'gmail.sync-metadata',
      'calendar.create-omnix-calendar',
      'calendar.upsert-omnix-event',
      'calendar.complete-omnix-event',
      'calendar.cancel-omnix-event',
      'calendar.delete-omnix-event',
      'calendar.sync',
    ],
    productionRequirements: ['OAuth consent verification', 'approved scopes', 'real-account UAT'],
  },
  {
    provider: 'mailchimp',
    label: 'Mailchimp',
    mode: 'provider-disabled',
    enabled: false,
    capabilities: ['audience.sync', 'audience.reconcile'],
    productionRequirements: ['registered OAuth app', 'selected audience', 'signed webhook', 'real-account UAT'],
  },
  {
    provider: 'twilio',
    label: 'Texting',
    mode: 'provider-disabled',
    enabled: false,
    capabilities: ['message.send', 'message.reconcile'],
    productionRequirements: ['restricted API key', 'Messaging Service', '10DLC when applicable', 'real-number UAT'],
  },
  {
    provider: 'meta',
    label: 'Instagram & Facebook',
    mode: 'provider-disabled',
    enabled: false,
    capabilities: ['dm.ingest', 'dm.review'],
    productionRequirements: ['business verification', 'App Review', 'approved assets and permissions', 'real-account UAT'],
  },
] as const;

function integerEnv(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConnectorError('configuration-required', `${name} must be ${min}–${max}.`);
  }
  return value;
}

function providerEnableVariable(provider: Exclude<ConnectorProvider, 'contract-test'>): string {
  return `OMNIX_CONNECTOR_${provider.toUpperCase()}_ENABLED`;
}

function configuredUrl(value: string | undefined, name: string): URL {
  try {
    const url = new URL(value?.trim() ?? '');
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error('unsafe');
    }
    return url;
  } catch {
    throw new ConnectorError('configuration-required', `${name} must be HTTPS or loopback HTTP.`);
  }
}

function providerNeutralFoundationEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...environment,
    OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'false',
    OMNIX_CONNECTOR_GOOGLE_ENABLED: 'false',
    OMNIX_CONNECTOR_TWILIO_ENABLED: 'false',
    OMNIX_CONNECTOR_META_ENABLED: 'false',
  };
}

/**
 * Provider-neutral foundation loader. Real providers intentionally fail closed
 * until their Story 4.x loader replaces the corresponding disabled definition.
 */
export function loadConnectorRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  for (const provider of CONNECTOR_PROVIDERS) {
    if (provider === 'contract-test') continue;
    if (environment[providerEnableVariable(provider)]?.trim().toLowerCase() === 'true') {
      throw new ConnectorError(
        'provider-disabled',
        `${provider} cannot be enabled by the shared foundation; complete its provider story first.`,
      );
    }
  }
  return {
    worker: {
      route: '/api/internal/connectors/drain',
      batchSize: integerEnv(environment, 'OMNIX_CONNECTOR_BATCH_SIZE', 10, 1, 25),
      leaseSeconds: integerEnv(environment, 'OMNIX_CONNECTOR_LEASE_SECONDS', 90, 30, 600),
      maxRuntimeSeconds: integerEnv(environment, 'OMNIX_CONNECTOR_MAX_RUNTIME_SECONDS', 45, 5, 50),
      reconciliationBatchSize: integerEnv(environment, 'OMNIX_CONNECTOR_RECONCILIATION_BATCH_SIZE', 10, 1, 25),
    },
    retry: {
      maxAttempts: integerEnv(environment, 'OMNIX_CONNECTOR_MAX_ATTEMPTS', 5, 1, 12),
      baseDelaySeconds: integerEnv(environment, 'OMNIX_CONNECTOR_RETRY_BASE_SECONDS', 15, 1, 600),
      maxDelaySeconds: integerEnv(environment, 'OMNIX_CONNECTOR_RETRY_MAX_SECONDS', 3_600, 30, 86_400),
    },
    definitions: DEFINITIONS.map((definition) => ({
      ...definition,
      capabilities: [...definition.capabilities],
      productionRequirements: [...definition.productionRequirements],
    })),
  };
}

export function connectorDefinition(
  configuration: ConnectorRuntimeConfiguration,
  provider: ConnectorProvider,
): ConnectorDefinition {
  const definition = configuration.definitions.find((item) => item.provider === provider);
  if (!definition) throw new ConnectorError('configuration-required', 'Connector definition is missing.');
  return definition;
}

/**
 * Story 4.1 activation gate. This never enables Mailchimp from a single flag:
 * every server-only credential and explicit UAT approval must be present.
 */
export function loadMailchimpActivatedRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  const configured = loadMailchimpConfiguredRuntimeConfiguration(environment);
  const mailchimp = connectorDefinition(configured, 'mailchimp');
  if (mailchimp.mode !== 'live') {
    throw new ConnectorError(
      'provider-disabled',
      'Mailchimp production activation requires approved real-account UAT.',
    );
  }
  return configured;
}

/**
 * Story 4.1 deployment loader. A fully configured provider starts in UAT mode;
 * production mode is a separate, explicit approval after the real-account
 * vertical slice succeeds. Both states keep all other providers disabled.
 */
export function loadMailchimpConfiguredRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  const required = [
    'MAILCHIMP_CLIENT_ID',
    'MAILCHIMP_CLIENT_SECRET',
    'MAILCHIMP_REDIRECT_URI',
    'MAILCHIMP_WEBHOOK_BASE_URL',
  ] as const;
  if (environment.OMNIX_CONNECTOR_MAILCHIMP_ENABLED?.trim().toLowerCase() !== 'true'
    || required.some((name) => !environment[name]?.trim())) {
    throw new ConnectorError(
      'provider-disabled',
      'Mailchimp requires explicit enablement and registered OAuth/webhook credentials.',
    );
  }
  const redirect = configuredUrl(environment.MAILCHIMP_REDIRECT_URI, 'MAILCHIMP_REDIRECT_URI');
  if (redirect.pathname !== '/api/connectors/mailchimp/callback' || redirect.search || redirect.hash) {
    throw new ConnectorError('configuration-required', 'MAILCHIMP_REDIRECT_URI must use the fixed Omnix callback path.');
  }
  const webhook = configuredUrl(environment.MAILCHIMP_WEBHOOK_BASE_URL, 'MAILCHIMP_WEBHOOK_BASE_URL');
  if (webhook.pathname !== '/api/connectors/mailchimp/webhook' || webhook.search || webhook.hash) {
    throw new ConnectorError('configuration-required', 'MAILCHIMP_WEBHOOK_BASE_URL must use the fixed Omnix webhook path.');
  }
  const productionApproved = environment.OMNIX_CONNECTOR_MAILCHIMP_REAL_ACCOUNT_UAT
    ?.trim().toLowerCase() === 'approved';
  const base = loadConnectorRuntimeConfiguration(providerNeutralFoundationEnvironment(environment));
  return {
    ...base,
    definitions: base.definitions.map((definition) => definition.provider === 'mailchimp'
      ? {
          ...definition,
          enabled: true,
          mode: productionApproved ? 'live' as const : 'uat' as const,
          productionRequirements: productionApproved
            ? [...definition.productionRequirements]
            : [...definition.productionRequirements, 'real-account UAT approval pending'],
        }
      : definition),
  };
}

/**
 * Story 4.2 deployment loader. A configured Google connector remains in UAT
 * until the restricted-scope review and real-account matrix are approved.
 */
export function loadGoogleConfiguredRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  const required = [
    'GOOGLE_CONNECTOR_CLIENT_ID',
    'GOOGLE_CONNECTOR_CLIENT_SECRET',
    'GOOGLE_CONNECTOR_REDIRECT_URI',
  ] as const;
  if (environment.OMNIX_CONNECTOR_GOOGLE_ENABLED?.trim().toLowerCase() !== 'true'
    || required.some((name) => !environment[name]?.trim())) {
    throw new ConnectorError('provider-disabled', 'Google requires explicit enablement and registered OAuth credentials.');
  }
  const redirect = configuredUrl(environment.GOOGLE_CONNECTOR_REDIRECT_URI, 'GOOGLE_CONNECTOR_REDIRECT_URI');
  if (redirect.pathname !== '/api/connectors/google/callback' || redirect.search || redirect.hash) {
    throw new ConnectorError('configuration-required', 'GOOGLE_CONNECTOR_REDIRECT_URI must use the fixed Omnix callback path.');
  }
  const productionApproved = environment.OMNIX_CONNECTOR_GOOGLE_REAL_ACCOUNT_UAT
    ?.trim().toLowerCase() === 'approved'
    && environment.OMNIX_CONNECTOR_GOOGLE_SCOPE_REVIEW?.trim().toLowerCase() === 'approved';
  const base = loadConnectorRuntimeConfiguration(providerNeutralFoundationEnvironment(environment));
  return {
    ...base,
    definitions: base.definitions.map((definition) => definition.provider === 'google'
      ? {
          ...definition,
          enabled: true,
          mode: productionApproved ? 'live' as const : 'uat' as const,
          productionRequirements: productionApproved
            ? [...definition.productionRequirements]
            : [...definition.productionRequirements, 'scope review and real-account UAT approval pending'],
        }
      : definition),
  };
}

export function loadGoogleActivatedRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  const configured = loadGoogleConfiguredRuntimeConfiguration(environment);
  if (connectorDefinition(configured, 'google').mode !== 'live') {
    throw new ConnectorError('provider-disabled', 'Google production activation requires scope review and approved real-account UAT.');
  }
  return configured;
}

/**
 * Story 4.3 deployment gate. Configured Twilio starts in UAT and can only be
 * promoted when registration, policy, callback and real-number evidence are
 * all explicitly approved. No browser credential or consumer login exists.
 */
export function loadTwilioConfiguredRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  const required = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_API_KEY_SID',
    'TWILIO_API_KEY_SECRET',
    'TWILIO_MESSAGING_SERVICE_SID',
    'TWILIO_WEBHOOK_AUTH_TOKEN',
    'TWILIO_CALLBACK_BASE_URL',
    'TWILIO_CALLBACK_ENDPOINT_KEY',
  ] as const;
  if (environment.OMNIX_CONNECTOR_TWILIO_ENABLED?.trim().toLowerCase() !== 'true'
    || required.some((name) => !environment[name]?.trim())) {
    throw new ConnectorError(
      'provider-disabled',
      'Texting requires explicit enablement, restricted Twilio credentials, a Messaging Service, and callback authority.',
    );
  }
  configuredUrl(environment.TWILIO_CALLBACK_BASE_URL, 'TWILIO_CALLBACK_BASE_URL');
  // Runtime configuration cannot assert provider-observed UAT evidence.
  const productionApproved = false;
  const base = loadConnectorRuntimeConfiguration(providerNeutralFoundationEnvironment(environment));
  return {
    ...base,
    definitions: base.definitions.map((definition) => definition.provider === 'twilio'
      ? {
          ...definition,
          enabled: true,
          mode: productionApproved ? 'live' as const : 'uat' as const,
          productionRequirements: productionApproved
            ? [...definition.productionRequirements]
            : [...definition.productionRequirements, 'registration, policy, callback, and real-number UAT approvals pending'],
        }
      : definition),
  };
}

export function loadTwilioActivatedRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  loadTwilioConfiguredRuntimeConfiguration(environment);
  throw new ConnectorError(
    'provider-disabled',
    'Texting production activation requires persisted registration, policy, signed callback, and real-number UAT evidence.',
  );
}

const META_GRAPH_VERSION_PATTERN = /^v\d{2,3}\.0$/;
const META_VERSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

function validatedMetaVersionAuthority(
  environment: Record<string, string | undefined>,
  now: Date,
): void {
  const version = environment.META_GRAPH_API_VERSION?.trim() ?? '';
  if (!META_GRAPH_VERSION_PATTERN.test(version)) {
    throw new ConnectorError('configuration-required', 'META_GRAPH_API_VERSION must be explicitly pinned; latest and implicit versions are forbidden.');
  }
  const verifiedAt = new Date(environment.META_GRAPH_API_VERSION_VERIFIED_AT?.trim() ?? '');
  const source = configuredUrl(environment.META_GRAPH_API_VERSION_SOURCE_URL, 'META_GRAPH_API_VERSION_SOURCE_URL');
  if (source.hostname !== 'developers.facebook.com' || !source.pathname.startsWith('/docs/graph-api/changelog')) {
    throw new ConnectorError('configuration-required', 'META_GRAPH_API_VERSION_SOURCE_URL must be the official Meta Graph API changelog.');
  }
  const age = now.getTime() - verifiedAt.getTime();
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(verifiedAt.getTime())
    || age < -5 * 60 * 1_000 || age > META_VERSION_MAX_AGE_MS) {
    throw new ConnectorError('configuration-required', 'META_GRAPH_API_VERSION verification is missing, stale, or future-dated.');
  }
}

/**
 * Story 4.4 deployment gate. This implements inbound business-message intake
 * only; Lead Ads and outbound replies remain absent. A numeric Graph version
 * is never guessed and must be freshly verified against Meta's official
 * changelog before even the UAT connector can start.
 */
export function loadMetaConfiguredRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): ConnectorRuntimeConfiguration {
  const required = [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_REDIRECT_URI',
    'META_WEBHOOK_BASE_URL',
  ] as const;
  if (environment.OMNIX_CONNECTOR_META_ENABLED?.trim().toLowerCase() !== 'true'
    || required.some((name) => !environment[name]?.trim())) {
    throw new ConnectorError(
      'provider-disabled',
      'Meta requires explicit enablement, a developer app, Business Login, and webhook authority.',
    );
  }
  validatedMetaVersionAuthority(environment, now);
  const redirect = configuredUrl(environment.META_REDIRECT_URI, 'META_REDIRECT_URI');
  if (redirect.pathname !== '/api/connectors/meta/callback' || redirect.search || redirect.hash) {
    throw new ConnectorError('configuration-required', 'META_REDIRECT_URI must use the fixed Omnix callback path.');
  }
  const webhook = configuredUrl(environment.META_WEBHOOK_BASE_URL, 'META_WEBHOOK_BASE_URL');
  if (webhook.pathname !== '/api/connectors/meta/webhook' || webhook.search || webhook.hash) {
    throw new ConnectorError('configuration-required', 'META_WEBHOOK_BASE_URL must use the fixed Omnix webhook path.');
  }
  const approvals = [
    'OMNIX_CONNECTOR_META_BUSINESS_VERIFIED',
    'OMNIX_CONNECTOR_META_APP_REVIEW_APPROVED',
    'OMNIX_CONNECTOR_META_RETENTION_POLICY_APPROVED',
    'OMNIX_CONNECTOR_META_REAL_ACCOUNT_UAT',
  ] as const;
  const productionApproved = approvals.every((name) => environment[name]?.trim().toLowerCase() === 'approved');
  const base = loadConnectorRuntimeConfiguration(providerNeutralFoundationEnvironment(environment));
  return {
    ...base,
    definitions: base.definitions.map((definition) => definition.provider === 'meta'
      ? {
          ...definition,
          enabled: true,
          mode: productionApproved ? 'live' as const : 'uat' as const,
          productionRequirements: productionApproved
            ? [...definition.productionRequirements]
            : [...definition.productionRequirements, 'Business Verification, App Review, retention policy, and real-account UAT pending'],
        }
      : definition),
  };
}

export function loadMetaActivatedRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): ConnectorRuntimeConfiguration {
  const configured = loadMetaConfiguredRuntimeConfiguration(environment, now);
  if (connectorDefinition(configured, 'meta').mode !== 'live') {
    throw new ConnectorError(
      'provider-disabled',
      'Meta production activation requires Business Verification, App Review, retention approval, and real-account UAT.',
    );
  }
  return configured;
}

/**
 * Composes every provider-specific deployment gate that is enabled in the
 * current process. This is the canonical loader for shared repository and
 * worker surfaces: enabling Google must not hide Mailchimp (or vice versa).
 */
export function loadConfiguredConnectorRuntimeConfiguration(
  environment: Record<string, string | undefined> = process.env,
): ConnectorRuntimeConfiguration {
  const mailchimpEnabled = environment.OMNIX_CONNECTOR_MAILCHIMP_ENABLED?.trim().toLowerCase() === 'true';
  const googleEnabled = environment.OMNIX_CONNECTOR_GOOGLE_ENABLED?.trim().toLowerCase() === 'true';
  const twilioEnabled = environment.OMNIX_CONNECTOR_TWILIO_ENABLED?.trim().toLowerCase() === 'true';
  const metaEnabled = environment.OMNIX_CONNECTOR_META_ENABLED?.trim().toLowerCase() === 'true';
  let configuration = loadConnectorRuntimeConfiguration({
    ...environment,
    OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'false',
    OMNIX_CONNECTOR_GOOGLE_ENABLED: 'false',
    OMNIX_CONNECTOR_TWILIO_ENABLED: 'false',
    OMNIX_CONNECTOR_META_ENABLED: 'false',
  });

  const mergeProvider = (
    source: ConnectorRuntimeConfiguration,
    provider: ConnectorProvider,
  ) => {
    const definition = source.definitions.find((candidate) => candidate.provider === provider);
    if (!definition) throw new ConnectorError('configuration-required', `${provider} connector definition is missing.`);
    configuration = {
      ...configuration,
      definitions: configuration.definitions.map((candidate) => candidate.provider === provider
        ? definition : candidate),
    };
  };

  if (mailchimpEnabled) {
    mergeProvider(loadMailchimpConfiguredRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_GOOGLE_ENABLED: 'false',
      OMNIX_CONNECTOR_TWILIO_ENABLED: 'false',
      OMNIX_CONNECTOR_META_ENABLED: 'false',
    }), 'mailchimp');
  }
  if (googleEnabled) {
    mergeProvider(loadGoogleConfiguredRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'false',
      OMNIX_CONNECTOR_TWILIO_ENABLED: 'false',
      OMNIX_CONNECTOR_META_ENABLED: 'false',
    }), 'google');
  }
  if (twilioEnabled) {
    mergeProvider(loadTwilioConfiguredRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'false',
      OMNIX_CONNECTOR_GOOGLE_ENABLED: 'false',
      OMNIX_CONNECTOR_META_ENABLED: 'false',
    }), 'twilio');
  }
  if (metaEnabled) {
    mergeProvider(loadMetaConfiguredRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'false',
      OMNIX_CONNECTOR_GOOGLE_ENABLED: 'false',
      OMNIX_CONNECTOR_TWILIO_ENABLED: 'false',
    }), 'meta');
  }
  return configuration;
}
