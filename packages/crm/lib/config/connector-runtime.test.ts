import { describe, expect, it } from 'vitest';
import {
  loadConnectorRuntimeConfiguration,
  loadConfiguredConnectorRuntimeConfiguration,
  loadGoogleActivatedRuntimeConfiguration,
  loadGoogleConfiguredRuntimeConfiguration,
  loadMailchimpActivatedRuntimeConfiguration,
  loadMailchimpConfiguredRuntimeConfiguration,
  loadMetaActivatedRuntimeConfiguration,
  loadMetaConfiguredRuntimeConfiguration,
  loadTwilioActivatedRuntimeConfiguration,
  loadTwilioConfiguredRuntimeConfiguration,
} from './connector-runtime';

describe('connector runtime configuration', () => {
  it('keeps real providers disabled and exposes the non-live contract adapter', () => {
    const configuration = loadConnectorRuntimeConfiguration({});
    expect(configuration.definitions.find((item) => item.provider === 'contract-test'))
      .toMatchObject({ enabled: true, mode: 'contract-test' });
    expect(configuration.definitions.filter((item) => item.provider !== 'contract-test'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ enabled: false, mode: 'provider-disabled' })]));
  });

  it('rejects attempts to enable a real provider before its provider story', () => {
    expect(() => loadConnectorRuntimeConfiguration({ OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true' }))
      .toThrow(/cannot be enabled/i);
  });

  it('validates bounded worker settings at boot', () => {
    expect(() => loadConnectorRuntimeConfiguration({ OMNIX_CONNECTOR_BATCH_SIZE: '1000' }))
      .toThrow(/1–25/);
    expect(loadConnectorRuntimeConfiguration({ OMNIX_CONNECTOR_BATCH_SIZE: '7' }).worker.batchSize).toBe(7);
  });

  it('separates configured UAT from approved production activation', () => {
    expect(() => loadMailchimpActivatedRuntimeConfiguration({
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true',
    })).toThrow(/OAuth\/webhook credentials/i);
    const uatConfiguration = loadMailchimpConfiguredRuntimeConfiguration({
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true',
      MAILCHIMP_CLIENT_ID: 'client-a',
      MAILCHIMP_CLIENT_SECRET: 'secret-a',
      MAILCHIMP_REDIRECT_URI: 'https://crm.example.com/api/connectors/mailchimp/callback',
      MAILCHIMP_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/mailchimp/webhook',
    });
    expect(uatConfiguration.definitions.find((item) => item.provider === 'mailchimp'))
      .toMatchObject({ enabled: true, mode: 'uat' });
    expect(() => loadMailchimpActivatedRuntimeConfiguration({
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true',
      MAILCHIMP_CLIENT_ID: 'client-a',
      MAILCHIMP_CLIENT_SECRET: 'secret-a',
      MAILCHIMP_REDIRECT_URI: 'https://crm.example.com/api/connectors/mailchimp/callback',
      MAILCHIMP_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/mailchimp/webhook',
    })).toThrow(/real-account UAT/i);
    const productionConfiguration = loadMailchimpActivatedRuntimeConfiguration({
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true',
      OMNIX_CONNECTOR_MAILCHIMP_REAL_ACCOUNT_UAT: 'approved',
      MAILCHIMP_CLIENT_ID: 'client-a',
      MAILCHIMP_CLIENT_SECRET: 'secret-a',
      MAILCHIMP_REDIRECT_URI: 'https://crm.example.com/api/connectors/mailchimp/callback',
      MAILCHIMP_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/mailchimp/webhook',
    });
    expect(productionConfiguration.definitions.find((item) => item.provider === 'mailchimp'))
      .toMatchObject({ enabled: true, mode: 'live' });
    expect(productionConfiguration.definitions.find((item) => item.provider === 'google'))
      .toMatchObject({ enabled: false, mode: 'provider-disabled' });
  });

  it('keeps configured Google in UAT until scope review and real-account approval', () => {
    const environment = {
      OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true',
      GOOGLE_CONNECTOR_CLIENT_ID: 'client-a',
      GOOGLE_CONNECTOR_CLIENT_SECRET: 'secret-a',
      GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
    };
    expect(loadGoogleConfiguredRuntimeConfiguration(environment).definitions.find((item) => item.provider === 'google'))
      .toMatchObject({ enabled: true, mode: 'uat' });
    expect(() => loadGoogleActivatedRuntimeConfiguration(environment)).toThrow(/scope review/i);
    expect(loadGoogleActivatedRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_GOOGLE_SCOPE_REVIEW: 'approved',
      OMNIX_CONNECTOR_GOOGLE_REAL_ACCOUNT_UAT: 'approved',
    }).definitions.find((item) => item.provider === 'google')).toMatchObject({ enabled: true, mode: 'live' });
  });

  it('composes Google and Mailchimp without hiding either configured provider', () => {
    const environment = {
      OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true',
      GOOGLE_CONNECTOR_CLIENT_ID: 'google-client',
      GOOGLE_CONNECTOR_CLIENT_SECRET: 'google-secret',
      GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true',
      MAILCHIMP_CLIENT_ID: 'mailchimp-client',
      MAILCHIMP_CLIENT_SECRET: 'mailchimp-secret',
      MAILCHIMP_REDIRECT_URI: 'https://crm.example.com/api/connectors/mailchimp/callback',
      MAILCHIMP_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/mailchimp/webhook',
    };
    const configuration = loadConfiguredConnectorRuntimeConfiguration(environment);
    expect(configuration.definitions.find((item) => item.provider === 'google'))
      .toMatchObject({ enabled: true, mode: 'uat' });
    expect(configuration.definitions.find((item) => item.provider === 'mailchimp'))
      .toMatchObject({ enabled: true, mode: 'uat' });
    expect(loadMailchimpConfiguredRuntimeConfiguration(environment).definitions.find((item) => item.provider === 'mailchimp'))
      .toMatchObject({ enabled: true, mode: 'uat' });
    expect(loadGoogleConfiguredRuntimeConfiguration(environment).definitions.find((item) => item.provider === 'google'))
      .toMatchObject({ enabled: true, mode: 'uat' });
  });

  it('keeps Twilio in UAT until registration, policy, callback, and real-number evidence are approved', () => {
    const environment = {
      OMNIX_CONNECTOR_TWILIO_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
      TWILIO_API_KEY_SECRET: 'secret-a',
      TWILIO_MESSAGING_SERVICE_SID: `MG${'c'.repeat(32)}`,
      TWILIO_WEBHOOK_AUTH_TOKEN: 'webhook-a',
      TWILIO_CALLBACK_BASE_URL: 'https://crm.example.com',
      TWILIO_CALLBACK_ENDPOINT_KEY: 'endpoint-key-1234',
    };
    expect(loadTwilioConfiguredRuntimeConfiguration(environment).definitions.find((item) => item.provider === 'twilio'))
      .toMatchObject({ enabled: true, mode: 'uat' });
    expect(() => loadTwilioActivatedRuntimeConfiguration(environment)).toThrow(/registration/i);
    expect(() => loadTwilioActivatedRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_TWILIO_REGISTRATION_APPROVED: 'approved',
      OMNIX_CONNECTOR_TWILIO_POLICY_APPROVED: 'approved',
      OMNIX_CONNECTOR_TWILIO_CALLBACK_UAT: 'approved',
      OMNIX_CONNECTOR_TWILIO_REAL_NUMBER_UAT: 'approved',
    })).toThrow(/persisted/i);
  });

  it('composes Google, Mailchimp, and Twilio without hiding a configured provider', () => {
    const configuration = loadConfiguredConnectorRuntimeConfiguration({
      OMNIX_CONNECTOR_GOOGLE_ENABLED: 'true',
      GOOGLE_CONNECTOR_CLIENT_ID: 'google-client', GOOGLE_CONNECTOR_CLIENT_SECRET: 'google-secret',
      GOOGLE_CONNECTOR_REDIRECT_URI: 'https://crm.example.com/api/connectors/google/callback',
      OMNIX_CONNECTOR_MAILCHIMP_ENABLED: 'true',
      MAILCHIMP_CLIENT_ID: 'mailchimp-client', MAILCHIMP_CLIENT_SECRET: 'mailchimp-secret',
      MAILCHIMP_REDIRECT_URI: 'https://crm.example.com/api/connectors/mailchimp/callback',
      MAILCHIMP_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/mailchimp/webhook',
      OMNIX_CONNECTOR_TWILIO_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`, TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
      TWILIO_API_KEY_SECRET: 'twilio-secret', TWILIO_MESSAGING_SERVICE_SID: `MG${'c'.repeat(32)}`,
      TWILIO_WEBHOOK_AUTH_TOKEN: 'webhook-secret', TWILIO_CALLBACK_BASE_URL: 'https://crm.example.com',
      TWILIO_CALLBACK_ENDPOINT_KEY: 'endpoint-key-1234',
    });
    expect(configuration.definitions.filter((item) => ['google', 'mailchimp', 'twilio'].includes(item.provider)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'google', enabled: true, mode: 'uat' }),
        expect.objectContaining({ provider: 'mailchimp', enabled: true, mode: 'uat' }),
        expect.objectContaining({ provider: 'twilio', enabled: true, mode: 'uat' }),
      ]));
  });

  it('fails Meta closed without an explicitly verified current Graph version', () => {
    const environment = {
      OMNIX_CONNECTOR_META_ENABLED: 'true',
      META_APP_ID: 'app-123', META_APP_SECRET: 'secret-a', META_WEBHOOK_VERIFY_TOKEN: 'verify-a',
      META_REDIRECT_URI: 'https://crm.example.com/api/connectors/meta/callback',
      META_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/meta/webhook',
      META_GRAPH_API_VERSION_SOURCE_URL: 'https://developers.facebook.com/docs/graph-api/changelog/versions',
    };
    const now = new Date('2026-08-12T12:00:00.000Z');
    expect(() => loadMetaConfiguredRuntimeConfiguration(environment, now)).toThrow(/explicitly pinned/i);
    expect(() => loadMetaConfiguredRuntimeConfiguration({
      ...environment,
      META_GRAPH_API_VERSION: 'latest', META_GRAPH_API_VERSION_VERIFIED_AT: now.toISOString(),
    }, now)).toThrow(/explicitly pinned/i);
    expect(() => loadMetaConfiguredRuntimeConfiguration({
      ...environment,
      META_GRAPH_API_VERSION: 'v999.0', META_GRAPH_API_VERSION_VERIFIED_AT: '2025-01-01T00:00:00.000Z',
    }, now)).toThrow(/stale/i);
  });

  it('keeps version-verified Meta inbound intake in UAT until every external approval is explicit', () => {
    const now = new Date('2026-08-12T12:00:00.000Z');
    const environment = {
      OMNIX_CONNECTOR_META_ENABLED: 'true',
      META_APP_ID: 'app-123', META_APP_SECRET: 'secret-a', META_WEBHOOK_VERIFY_TOKEN: 'verify-a',
      META_REDIRECT_URI: 'https://crm.example.com/api/connectors/meta/callback',
      META_WEBHOOK_BASE_URL: 'https://crm.example.com/api/connectors/meta/webhook',
      META_GRAPH_API_VERSION: 'v999.0',
      META_GRAPH_API_VERSION_VERIFIED_AT: now.toISOString(),
      META_GRAPH_API_VERSION_SOURCE_URL: 'https://developers.facebook.com/docs/graph-api/changelog/versions',
    };
    expect(loadMetaConfiguredRuntimeConfiguration(environment, now).definitions.find((item) => item.provider === 'meta'))
      .toMatchObject({ enabled: true, mode: 'uat', capabilities: ['dm.ingest', 'dm.review'] });
    expect(() => loadMetaActivatedRuntimeConfiguration(environment, now)).toThrow(/Business Verification/i);
    expect(loadMetaActivatedRuntimeConfiguration({
      ...environment,
      OMNIX_CONNECTOR_META_BUSINESS_VERIFIED: 'approved',
      OMNIX_CONNECTOR_META_APP_REVIEW_APPROVED: 'approved',
      OMNIX_CONNECTOR_META_RETENTION_POLICY_APPROVED: 'approved',
      OMNIX_CONNECTOR_META_REAL_ACCOUNT_UAT: 'approved',
    }, now).definitions.find((item) => item.provider === 'meta')).toMatchObject({ enabled: true, mode: 'live' });
  });
});
