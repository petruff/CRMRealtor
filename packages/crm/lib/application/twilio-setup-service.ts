import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex } from '../domain/connector.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { loadTwilioConfiguration, TwilioMessagingClient, type TwilioFetch } from '../providers/twilio-client.ts';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '../security/connector-secret-envelope.ts';

function env(value: string | undefined, name: string, pattern?: RegExp): string {
  const clean = value?.trim() ?? '';
  if (!clean || clean.length > 4_096 || /[\u0000-\u001f\u007f]/.test(clean) || (pattern && !pattern.test(clean))) {
    throw new ConnectorError('configuration-required', `${name} is missing or invalid.`);
  }
  return clean;
}
function integer(value: string, name: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConnectorError('configuration-required', `${name} is outside its approved range.`);
  }
  return parsed;
}
function secret(value: ReturnType<typeof encryptConnectorSecret>) {
  return {
    ciphertext: value.ciphertext, nonce: value.iv, authTag: value.tag,
    wrappedDek: value.encryptedDek, wrapNonce: value.encryptedDekIv,
    wrapAuthTag: value.encryptedDekTag, kekVersion: value.kekVersion, aadHash: value.aadHash, expiresAt: null,
  };
}
function failure(error: { code?: string }, message: string): never {
  if (error.code === '42501') throw new ConnectorError('forbidden', message);
  if (error.code === 'P0002') throw new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) throw new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) throw new ConnectorError('invalid-input', message);
  throw new Error(`${message}: persistence failed.`);
}

export async function configureTwilioConnection(input: {
  authenticated: SupabaseClient; service: SupabaseClient; scope: WorkspaceScope;
  connectionId?: string; environment?: Record<string, string | undefined>; fetcher?: TwilioFetch; now?: Date;
}) {
  if (input.scope.mode !== 'live' || input.scope.role !== 'owner') {
    throw new ConnectorError('forbidden', 'Only the live workspace owner can configure Twilio.');
  }
  const environment = input.environment ?? process.env;
  const now = input.now ?? new Date();
  const correlationId = randomUUID();
  const configuration = loadTwilioConfiguration(environment);
  if (!configuration.webhookAuthToken) {
    throw new ConnectorError('configuration-required', 'TWILIO_WEBHOOK_AUTH_TOKEN is required for signed callbacks.');
  }
  const providerClient = new TwilioMessagingClient(configuration, input.fetcher);
  const probe = await providerClient.probeMessagingService();
  const callbackBase = configuration.callbackBaseUrl.replace(/\/$/, '');
  const inboundUrl = `${callbackBase}/api/connectors/twilio/${configuration.callbackEndpointKey}/inbound`;
  const statusUrl = `${callbackBase}/api/connectors/twilio/${configuration.callbackEndpointKey}/status`;
  let connectionId = input.connectionId;
  if (!connectionId) {
    const created = await input.authenticated.rpc('create_connector_connection', {
      target_workspace_id: input.scope.workspaceId, target_provider: 'twilio',
      target_display_label: 'Twilio Messaging Service', target_correlation_id: correlationId,
    });
    if (created.error) failure(created.error, 'Twilio connection could not be created');
    const value = created.data as { connection?: { id?: unknown } } | null;
    if (typeof value?.connection?.id !== 'string') throw new ConnectorError('conflict', 'Twilio connection result is invalid.');
    connectionId = value.connection.id;
  }
  const useCase = env(environment.OMNIX_TWILIO_APPROVED_USE_CASE, 'OMNIX_TWILIO_APPROVED_USE_CASE', /^[a-z][a-z0-9.-]{1,79}$/);
  const disclosureVersion = env(environment.OMNIX_TWILIO_DISCLOSURE_VERSION, 'OMNIX_TWILIO_DISCLOSURE_VERSION', /^[A-Za-z0-9._-]{1,80}$/);
  const policyHash = env(environment.OMNIX_TWILIO_POLICY_HASH, 'OMNIX_TWILIO_POLICY_HASH', /^[0-9a-f]{64}$/);
  const keywordHash = env(environment.OMNIX_TWILIO_KEYWORD_CONFIGURATION_HASH, 'OMNIX_TWILIO_KEYWORD_CONFIGURATION_HASH', /^[0-9a-f]{64}$/);
  const registrationState = env(environment.OMNIX_TWILIO_REGISTRATION_STATE, 'OMNIX_TWILIO_REGISTRATION_STATE') as 'not_configured' | 'approved' | 'not_required' | 'pending' | 'rejected' | 'expired';
  if (!['not_configured', 'approved', 'not_required', 'pending', 'rejected', 'expired'].includes(registrationState)) {
    throw new ConnectorError('configuration-required', 'Twilio registration state is invalid.');
  }
  const registrationEvidence = ['approved', 'not_required'].includes(registrationState)
    ? env(environment.OMNIX_TWILIO_REGISTRATION_EVIDENCE_HASH, 'OMNIX_TWILIO_REGISTRATION_EVIDENCE_HASH', /^[0-9a-f]{64}$/)
    : null;
  const policy = await input.authenticated.rpc('configure_twilio_compliance_policy', {
    target_connection_id: connectionId, target_use_case: useCase, target_disclosure_version: disclosureVersion,
    target_policy_hash: policyHash,
    target_retention_days: integer(env(environment.OMNIX_TWILIO_RETENTION_DAYS, 'OMNIX_TWILIO_RETENTION_DAYS'), 'OMNIX_TWILIO_RETENTION_DAYS', 1, 3_650),
    target_quiet_hours_start: env(environment.OMNIX_TWILIO_QUIET_HOURS_START, 'OMNIX_TWILIO_QUIET_HOURS_START', /^\d{2}:\d{2}$/),
    target_quiet_hours_end: env(environment.OMNIX_TWILIO_QUIET_HOURS_END, 'OMNIX_TWILIO_QUIET_HOURS_END', /^\d{2}:\d{2}$/),
    target_unknown_timezone_action: 'defer', target_default_defer_minutes: 720,
    target_require_verified_timezone: true, target_keyword_configuration_hash: keywordHash,
    target_correlation_id: correlationId, target_effective_at: now.toISOString(),
  });
  if (policy.error) failure(policy.error, 'Twilio compliance policy could not be configured');
  const automation = await input.authenticated.rpc('ensure_twilio_message_send_policy', {
    target_workspace_id: input.scope.workspaceId, target_connection_id: connectionId,
    target_correlation_id: correlationId, target_occurred_at: now.toISOString(),
  });
  if (automation.error) failure(automation.error, 'Twilio approval policy could not be initialized');
  const resolver = createEnvironmentKekResolver(environment);
  const setupState = await input.service.rpc('read_twilio_setup_state', {
    target_connection_id: connectionId, target_authenticated_user_id: input.scope.authenticatedUserId,
    target_membership_id: input.scope.membershipId,
  });
  if (setupState.error) failure(setupState.error, 'Twilio setup authority could not be read');
  const versions = setupState.data as {
    providerAuthoritySecretVersion?: unknown; apiCredentialSecretVersion?: unknown; webhookSecretVersion?: unknown;
  } | null;
  const version = (value: unknown, label: string) => {
    if (value === null || value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', `Twilio ${label} version is invalid.`);
    return Number(value);
  };
  const providerVersion = version(versions?.providerAuthoritySecretVersion, 'provider authority');
  const apiVersion = version(versions?.apiCredentialSecretVersion, 'API credential');
  const webhookVersion = version(versions?.webhookSecretVersion, 'webhook credential');
  const provider = encryptConnectorSecret(JSON.stringify({
    schemaVersion: 'twilio-provider-authority.v1', accountSid: configuration.accountSid,
    apiKeySid: configuration.apiKeySid, messagingServiceSid: configuration.messagingServiceSid,
    senderMode: 'messaging_service',
  }), { workspaceId: input.scope.workspaceId, connectionId, provider: 'twilio', secretType: 'twilio-provider-authority', recordVersion: (providerVersion ?? 0) + 1 }, resolver);
  const api = encryptConnectorSecret(JSON.stringify({
    schemaVersion: 'twilio-api-key-secret.v1', apiKeySecret: configuration.apiKeySecret,
  }), { workspaceId: input.scope.workspaceId, connectionId, provider: 'twilio', secretType: 'twilio-api-key-secret', recordVersion: (apiVersion ?? 0) + 1 }, resolver);
  const webhook = encryptConnectorSecret(JSON.stringify({
    schemaVersion: 'twilio-webhook-auth-token.v1', authToken: configuration.webhookAuthToken,
  }), { workspaceId: input.scope.workspaceId, connectionId, provider: 'twilio', secretType: 'twilio-webhook-auth-token', recordVersion: (webhookVersion ?? 0) + 1 }, resolver);
  // Callback/UAT evidence is provider-observed and is projected only by the
  // signed callback workflow. Deployment configuration cannot declare it.
  const callbackApproved = false;
  const authority = await input.service.rpc('bind_twilio_connection_authority', {
    target_authenticated_user_id: input.scope.authenticatedUserId, target_membership_id: input.scope.membershipId,
    target_connection_id: connectionId, target_account_sid_hash: sha256Hex(probe.accountSid),
    target_api_key_sid_hash: sha256Hex(configuration.apiKeySid),
    target_messaging_service_sid_hash: sha256Hex(probe.serviceSid), target_sender_key_hash: sha256Hex(probe.serviceSid),
    target_sender_kind: 'messaging_service', target_registration_state: registrationState,
    target_registration_evidence_hash: registrationEvidence, target_approved_use_case: useCase,
    target_exact_external_url_hash: sha256Hex(inboundUrl),
    target_callback_verified_at: null,
    target_real_number_uat_evidence_hash: null, target_real_number_uat_at: null,
    target_restricted_credential: true, target_sender_ownership_verified_at: now.toISOString(),
    target_enabled: true, target_endpoint_key_hash: sha256Hex(configuration.callbackEndpointKey),
    target_expected_provider_authority_version: providerVersion ?? null, target_provider_authority_envelope: secret(provider),
    target_expected_api_secret_version: apiVersion ?? null, target_api_secret_envelope: secret(api),
    target_expected_webhook_secret_version: webhookVersion ?? null, target_webhook_secret_envelope: secret(webhook),
    target_correlation_id: correlationId, target_occurred_at: now.toISOString(),
  });
  if (authority.error) failure(authority.error, 'Twilio credential authority could not be bound');
  const routes = await input.service.rpc('bind_twilio_callback_routes', {
    target_connection_id: connectionId, target_authenticated_user_id: input.scope.authenticatedUserId,
    target_membership_id: input.scope.membershipId, target_endpoint_key_hash: sha256Hex(configuration.callbackEndpointKey),
    target_inbound_external_url_hash: sha256Hex(inboundUrl), target_status_external_url_hash: sha256Hex(statusUrl),
    target_correlation_id: correlationId, target_occurred_at: now.toISOString(),
  });
  if (routes.error) failure(routes.error, 'Twilio callback routes could not be bound');
  await providerClient.configureMessagingServiceCallbacks({ inboundUrl, statusUrl });
  return { connectionId, callbackApproved, registrationState };
}
