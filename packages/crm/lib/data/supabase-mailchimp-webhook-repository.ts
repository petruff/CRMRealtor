import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError } from '../domain/connector.ts';
import { mailchimpSubscriberHash, type MailchimpAudienceMember, type MailchimpWebhookEvent } from '../domain/mailchimp.ts';
import type { ConnectorSecretEnvelope } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ConnectorError('conflict', `${field} is invalid.`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ConnectorError('conflict', `${field} is invalid.`);
  return Number(value);
}

function bytea(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ConnectorError('invalid-input', 'Mailchimp encrypted webhook material is invalid.');
  return `\\x${bytes.toString('hex')}`;
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

export interface MailchimpWebhookSetupState {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly secretVersion?: number;
  readonly webhookRegistrationRequired: boolean;
  readonly endpointBound: boolean;
}

export interface MailchimpWebhookSigningAuthority {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly audienceBindingId: string;
  readonly audienceId: string;
  readonly endpointBindingId: string;
  readonly secretVersion: number;
  readonly signingSecretEnvelope: ConnectorSecretEnvelope;
}

export interface MailchimpWebhookJob {
  readonly id: string;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly deliveryId: string;
  readonly fencingToken: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}

export interface MailchimpBaselineApplyResult {
  readonly outcome: string;
  readonly noOp: boolean;
}

export interface SupabaseMailchimpWebhookRepository {
  readSetupState(connectionId: string): Promise<MailchimpWebhookSetupState>;
  bindSigningSecret(input: {
    readonly connectionId: string;
    readonly endpointKeyHash: string;
    readonly expectedSecretVersion?: number;
    readonly webhookIdHash: string;
    readonly envelope: ConnectorSecretEnvelope;
    readonly occurredAt: string;
    readonly correlationId: string;
  }): Promise<{ readonly secretVersion: number; readonly noOp: boolean }>;
  readSigningAuthority(endpointKeyHash: string, now: string): Promise<MailchimpWebhookSigningAuthority>;
  register(input: {
    readonly authority: MailchimpWebhookSigningAuthority;
    readonly event: MailchimpWebhookEvent;
    readonly replayKeyHash: string;
    readonly rawBodyHash: string;
    readonly payloadHash: string;
    readonly correlationId: string;
    readonly receivedAt: string;
    readonly envelope: ConnectorSecretEnvelope;
  }): Promise<{ readonly accepted: boolean; readonly duplicate: boolean; readonly jobId?: string }>;
  applyBaselineMember(input: {
    readonly connectionId: string;
    readonly audienceId: string;
    readonly member: MailchimpAudienceMember;
    readonly sourceHash: string;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<MailchimpBaselineApplyResult>;
  completeBaseline(input: {
    readonly connectionId: string;
    readonly bindingId: string;
    readonly providerRequestHash: string;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<{ readonly noOp: boolean }>;
  claim(input: { readonly workerId: string; readonly batchSize: number; readonly leaseSeconds: number; readonly now: string }): Promise<readonly MailchimpWebhookJob[]>;
  start(input: { readonly job: MailchimpWebhookJob; readonly workerId: string; readonly now: string }): Promise<MailchimpWebhookJob>;
  readPayload(input: { readonly job: MailchimpWebhookJob; readonly workerId: string; readonly now: string }): Promise<{
    readonly eventEnvelope: ConnectorSecretEnvelope;
    readonly envelopeVersion: number;
    readonly audienceId: string;
  }>;
  apply(input: { readonly job: MailchimpWebhookJob; readonly workerId: string; readonly event: MailchimpWebhookEvent }): Promise<{ readonly outcome: string }>;
  transition(input: {
    readonly job: MailchimpWebhookJob;
    readonly workerId: string;
    readonly outcome: 'succeeded' | 'retry' | 'review';
    readonly errorCategory?: string;
    readonly retryAt?: string;
    readonly occurredAt: string;
  }): Promise<void>;
}

function webhookJob(value: unknown): MailchimpWebhookJob {
  const row = object(value, 'Mailchimp webhook job is invalid.');
  return {
    id: text(row.id, 'jobId'), workspaceId: text(row.workspace_id, 'workspaceId'),
    connectionId: text(row.connection_id, 'connectionId'), bindingId: text(row.binding_id, 'bindingId'),
    deliveryId: text(row.delivery_id, 'deliveryId'), fencingToken: integer(row.fencing_token, 'fencingToken'),
    attemptCount: nonNegativeInteger(row.attempt_count, 'attemptCount'),
    maxAttempts: integer(row.max_attempts, 'maxAttempts'),
  };
}

function envelope(row: Record<string, unknown>): ConnectorSecretEnvelope {
  return {
    schemaVersion: 'connector-secret-envelope.v1', algorithm: 'AES-256-GCM',
    ciphertext: text(row.ciphertext, 'ciphertext'), iv: text(row.nonce, 'nonce'), tag: text(row.authTag, 'authTag'),
    encryptedDek: text(row.wrappedDek, 'wrappedDek'), encryptedDekIv: text(row.wrapNonce, 'wrapNonce'),
    encryptedDekTag: text(row.wrapAuthTag, 'wrapAuthTag'), kekVersion: text(row.kekVersion, 'kekVersion'),
    aadHash: text(row.aadHash, 'aadHash'),
  };
}

export function supabaseMailchimpWebhookRepository(service: SupabaseClient): SupabaseMailchimpWebhookRepository {
  return {
    async readSetupState(connectionId) {
      const { data, error } = await service.rpc('read_mailchimp_webhook_setup_state', {
        target_connection_id: connectionId,
      });
      if (error) throw persistenceError('Failed to read Mailchimp webhook setup state', error);
      const row = object(data, 'Mailchimp webhook setup state is invalid.');
      const secretVersion = row.secretVersion === null ? undefined : integer(row.secretVersion, 'secretVersion');
      return {
        workspaceId: text(row.workspaceId, 'workspaceId'), connectionId: text(row.connectionId, 'connectionId'),
        ...(secretVersion ? { secretVersion } : {}),
        webhookRegistrationRequired: row.webhookRegistrationRequired === true,
        endpointBound: row.endpointBound === true,
      };
    },

    async bindSigningSecret(input) {
      const encrypted = input.envelope;
      const { data, error } = await service.rpc('bind_mailchimp_webhook_secret', {
        target_connection_id: input.connectionId, target_endpoint_key_hash: input.endpointKeyHash,
        target_expected_secret_version: input.expectedSecretVersion ?? null,
        target_ciphertext: bytea(encrypted.ciphertext), target_nonce: bytea(encrypted.iv),
        target_auth_tag: bytea(encrypted.tag), target_wrapped_dek: bytea(encrypted.encryptedDek),
        target_wrap_nonce: bytea(encrypted.encryptedDekIv), target_wrap_auth_tag: bytea(encrypted.encryptedDekTag),
        target_kek_version: encrypted.kekVersion, target_aad_hash: encrypted.aadHash,
        target_webhook_id_hash: input.webhookIdHash, target_occurred_at: input.occurredAt,
        target_correlation_id: input.correlationId,
      });
      if (error) throw persistenceError('Failed to bind Mailchimp webhook signing authority', error);
      const result = object(data, 'Mailchimp webhook signing authority is invalid.');
      const secret = object(result.secret, 'Mailchimp webhook secret receipt is missing.');
      return { secretVersion: integer(secret.secretVersion, 'secretVersion'), noOp: result.noOp === true };
    },

    async readSigningAuthority(endpointKeyHash, now) {
      const { data, error } = await service.rpc('read_mailchimp_webhook_signing_secret', {
        target_endpoint_key_hash: endpointKeyHash, target_now: now,
      });
      if (error) throw persistenceError('Mailchimp webhook endpoint was not found', error);
      const result = object(data, 'Mailchimp webhook signing authority is invalid.');
      const audience = object(result.audienceBinding, 'Mailchimp audience binding is missing.');
      const endpoint = object(result.endpointBinding, 'Mailchimp endpoint binding is missing.');
      const secret = object(result.secret, 'Mailchimp webhook secret is missing.');
      return {
        workspaceId: text(result.workspaceId, 'workspaceId'), connectionId: text(result.connectionId, 'connectionId'),
        audienceBindingId: text(audience.bindingId, 'audienceBindingId'), audienceId: text(audience.audienceId, 'audienceId'),
        endpointBindingId: text(endpoint.bindingId, 'endpointBindingId'), secretVersion: integer(secret.secretVersion, 'secretVersion'),
        signingSecretEnvelope: envelope(secret),
      };
    },

    async register(input) {
      const encrypted = input.envelope;
      const { data, error } = await service.rpc('register_mailchimp_webhook_event_encrypted', {
        target_connection_id: input.authority.connectionId, target_audience_external_id: input.event.audienceId,
        target_replay_key_hash: input.replayKeyHash, target_raw_body_hash: input.rawBodyHash,
        target_signature_valid: true, target_timestamp_valid: true, target_payload_hash: input.payloadHash,
        target_ciphertext: bytea(encrypted.ciphertext), target_nonce: bytea(encrypted.iv),
        target_auth_tag: bytea(encrypted.tag), target_wrapped_dek: bytea(encrypted.encryptedDek),
        target_wrap_nonce: bytea(encrypted.encryptedDekIv), target_wrap_auth_tag: bytea(encrypted.encryptedDekTag),
        target_kek_version: encrypted.kekVersion, target_aad_hash: encrypted.aadHash,
        target_correlation_id: input.correlationId, target_received_at: input.receivedAt, target_max_attempts: 5,
      });
      if (error) throw persistenceError('Failed to register Mailchimp webhook event', error);
      const result = object(data, 'Mailchimp webhook registration is invalid.');
      const job = result.webhookJob ? object(result.webhookJob, 'Mailchimp webhook job is invalid.') : undefined;
      return { accepted: result.accepted === true, duplicate: result.noOp === true, ...(job ? { jobId: text(job.id, 'jobId') } : {}) };
    },

    async applyBaselineMember(input) {
      const { data, error } = await service.rpc('apply_mailchimp_baseline_member', {
        target_connection_id: input.connectionId, target_audience_external_id: input.audienceId,
        target_member_external_id: input.member.memberId, target_subscriber_hash: mailchimpSubscriberHash(input.member.normalizedEmail),
        target_normalized_email: input.member.normalizedEmail, target_subscription_status: input.member.subscriptionStatus,
        target_source_key_hash: input.sourceHash, target_correlation_id: input.correlationId,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to apply Mailchimp baseline member', error);
      const result = object(data, 'Mailchimp baseline result is invalid.');
      return { outcome: text(result.outcome, 'outcome'), noOp: result.noOp === true };
    },

    async completeBaseline(input) {
      const { data, error } = await service.rpc('complete_mailchimp_audience_baseline', {
        target_connection_id: input.connectionId, target_binding_id: input.bindingId,
        target_provider_request_hash: input.providerRequestHash, target_correlation_id: input.correlationId,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to complete Mailchimp baseline', error);
      return { noOp: object(data, 'Mailchimp baseline completion is invalid.').noOp === true };
    },

    async claim(input) {
      const { data, error } = await service.rpc('claim_mailchimp_webhook_jobs', {
        target_worker_id: input.workerId, target_batch_size: input.batchSize,
        target_lease_seconds: input.leaseSeconds, target_now: input.now,
      });
      if (error) throw persistenceError('Failed to claim Mailchimp webhook jobs', error);
      return ((data ?? []) as unknown[]).map(webhookJob);
    },

    async start(input) {
      const { data, error } = await service.rpc('start_mailchimp_webhook_job', {
        target_webhook_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_started_at: input.now,
      });
      if (error) throw persistenceError('Failed to start Mailchimp webhook job', error);
      return webhookJob(object(data, 'Mailchimp webhook start is invalid.').webhookJob);
    },

    async readPayload(input) {
      const { data, error } = await service.rpc('read_claimed_mailchimp_webhook_payload', {
        target_webhook_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_now: input.now,
      });
      if (error) throw persistenceError('Failed to read Mailchimp webhook payload', error);
      const result = object(data, 'Mailchimp webhook payload is invalid.');
      const payload = object(result.payload, 'Mailchimp webhook envelope is missing.');
      return { eventEnvelope: envelope(payload), envelopeVersion: integer(payload.envelopeVersion, 'envelopeVersion'), audienceId: text(result.audienceId, 'audienceId') };
    },

    async apply(input) {
      const event = input.event;
      const { data, error } = await service.rpc('apply_claimed_mailchimp_inbound_subscription_event', {
        target_webhook_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_member_external_id: event.memberId ?? event.eventId,
        target_subscriber_hash: mailchimpSubscriberHash(event.normalizedEmail),
        target_normalized_email: event.normalizedEmail, target_subscription_status: event.subscriptionStatus,
        target_provider_event_id_hash: event.eventId, target_originating_operation_key_hash: null,
        target_occurred_at: event.occurredAt,
      });
      if (error) throw persistenceError('Failed to apply Mailchimp webhook event', error);
      const result = object(data, 'Mailchimp webhook apply result is invalid.');
      return { outcome: text(result.outcome, 'outcome') };
    },

    async transition(input) {
      const { error } = await service.rpc('transition_mailchimp_webhook_job', {
        target_webhook_job_id: input.job.id, target_worker_id: input.workerId,
        target_fencing_token: input.job.fencingToken, target_outcome: input.outcome,
        target_error_category: input.errorCategory ?? null, target_retry_at: input.retryAt ?? null,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to transition Mailchimp webhook job', error);
    },
  };
}
