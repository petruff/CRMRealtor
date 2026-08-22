import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConnectorError, sha256Hex, stablePayloadHash } from '../domain/connector.ts';
import { evaluateTextingQuietHours, nextAllowedTextingTime, parseE164Phone, parseTextMessageBody, type TextingConsentStatus } from '../domain/texting.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createEnvironmentKekResolver, encryptConnectorSecret } from '../security/connector-secret-envelope.ts';

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectorError('conflict', message);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ConnectorError('conflict', `${field} is invalid.`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new ConnectorError('conflict', `${field} is invalid.`);
  return parsed;
}

function persistenceError(message: string, error: { code?: string }): Error {
  if (error.code === '42501') return new ConnectorError('forbidden', message);
  if (error.code === 'P0002') return new ConnectorError('not-found', message);
  if (['23505', '40001'].includes(error.code ?? '')) return new ConnectorError('conflict', message);
  if (['22023', '23503', '23514'].includes(error.code ?? '')) return new ConnectorError('invalid-input', message);
  return new Error(`${message}: persistence failed.`);
}

function envelopeJson(value: ReturnType<typeof encryptConnectorSecret>) {
  return {
    ciphertext: value.ciphertext, nonce: value.iv, authTag: value.tag,
    wrappedDek: value.encryptedDek, wrapNonce: value.encryptedDekIv,
    wrapAuthTag: value.encryptedDekTag, kekVersion: value.kekVersion, aadHash: value.aadHash,
    expiresAt: null,
  };
}

export interface TwilioReadinessState {
  readonly connectionId: string;
  readonly status: string;
  readonly readiness: string;
  readonly registration: string;
  readonly enabled: boolean;
  readonly providerBacked: boolean;
  readonly realNumberUatRequired: boolean;
  readonly deviceSmsFallbackSeparate: true;
  readonly useCase?: string;
  readonly disclosureVersion?: string;
  readonly quietHoursStart?: string;
  readonly quietHoursEnd?: string;
}

export interface TwilioTextingSummary {
  readonly consent?: { readonly status: TextingConsentStatus; readonly useCase: string; readonly effectiveAt: string;
    readonly recipientTimeZone?: string; readonly timezoneSource?: string };
  readonly messages: readonly {
    readonly id: string; readonly direction: 'inbound' | 'outbound'; readonly status: string;
    readonly createdAt: string; readonly errorCategory?: string;
  }[];
}

export interface TwilioOperationRepository {
  readReadiness(scope: WorkspaceScope, connectionId: string): Promise<TwilioReadinessState>;
  readContactSummary(scope: WorkspaceScope, connectionId: string, contactId: string, contactPointId: string): Promise<TwilioTextingSummary>;
  recordConsent(scope: WorkspaceScope, input: {
    readonly connectionId: string; readonly contactId: string; readonly contactPointId: string;
    readonly useCase: string; readonly status: TextingConsentStatus; readonly collectionMethod: string;
    readonly disclosureVersion: string; readonly evidenceHash: string; readonly recipientTimeZone?: string;
    readonly timezoneSource?: string; readonly correlationId: string; readonly occurredAt: string;
  }): Promise<{ readonly noOp: boolean; readonly canceledJobs: number }>;
  createDraftAndIntent(scope: WorkspaceScope, input: {
    readonly connectionId: string; readonly draftId: string; readonly contactId: string;
    readonly contactPointId: string; readonly recipientPhone: string; readonly useCase: string;
    readonly reviewedAliasEpoch: number;
    readonly body: string; readonly summary: string; readonly correlationId: string; readonly occurredAt: string;
  }): Promise<{ readonly draftId: string; readonly draftVersion: number; readonly intentId: string; readonly intentVersion: number }>;
  approvePreparedIntent(scope: WorkspaceScope, input: {
    readonly intentId: string; readonly intentVersion: number; readonly payloadHash: string;
    readonly idempotencyKey: string; readonly correlationId: string; readonly evaluatedAt: string;
  }): Promise<{ readonly jobId: string; readonly noOp: boolean }>;
  requestRealNumberUat(scope: WorkspaceScope, input: {
    readonly connectionId: string; readonly contactId: string; readonly contactPointId: string;
    readonly recipientPhone: string; readonly body: string; readonly recipientTimeZone?: string;
    readonly timezoneSource?: string; readonly occurredAt: string;
  }): Promise<{ readonly jobId: string; readonly noOp: boolean }>;
  disable(scope: WorkspaceScope, input: {
    readonly connectionId: string; readonly destroySendCredentials: boolean;
    readonly correlationId: string; readonly occurredAt: string;
  }): Promise<{ readonly canceledJobs: number; readonly destroyedSecrets: number; readonly noOp: boolean }>;
}

export function supabaseTwilioOperationRepository(client: SupabaseClient): TwilioOperationRepository {
  return {
    async readReadiness(_scope, connectionId) {
      const { data, error } = await client.rpc('read_twilio_connection_readiness', { target_connection_id: connectionId });
      if (error) throw persistenceError('Failed to read Twilio readiness', error);
      const result = object(data, 'Twilio readiness is invalid.');
      const connection = object(result.connection, 'Twilio connection is invalid.');
      const authority = result.authority ? object(result.authority, 'Twilio authority is invalid.') : {};
      const policy = result.policy ? object(result.policy, 'Twilio policy is invalid.') : {};
      return {
        connectionId: text(connection.id, 'connectionId'), status: text(connection.status, 'connectionStatus'),
        readiness: typeof authority.readiness_state === 'string' ? authority.readiness_state : 'configuration_required',
        registration: typeof authority.registration_state === 'string' ? authority.registration_state : 'not_started',
        enabled: authority.enabled === true, providerBacked: result.providerBacked === true,
        realNumberUatRequired: result.realNumberUatRequired === true,
        deviceSmsFallbackSeparate: true,
        ...(typeof policy.use_case === 'string' ? { useCase: policy.use_case } : {}),
        ...(typeof policy.disclosure_version === 'string' ? { disclosureVersion: policy.disclosure_version } : {}),
        ...(typeof policy.quiet_hours_start === 'string' ? { quietHoursStart: policy.quiet_hours_start } : {}),
        ...(typeof policy.quiet_hours_end === 'string' ? { quietHoursEnd: policy.quiet_hours_end } : {}),
      };
    },
    async readContactSummary(scope, connectionId, contactId, contactPointId) {
      const [consentResult, messageResult] = await Promise.all([
        client.from('texting_consent_states').select('status,use_case,effective_at,recipient_timezone,timezone_source')
          .eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId)
          .eq('contact_id', contactId).eq('contact_point_id', contactPointId)
          .order('effective_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('texting_messages').select('id,direction,status,created_at,last_error_category')
          .eq('workspace_id', scope.workspaceId).eq('connection_id', connectionId).eq('contact_id', contactId)
          .order('created_at', { ascending: false }).limit(50),
      ]);
      if (consentResult.error) throw persistenceError('Failed to read texting consent', consentResult.error);
      if (messageResult.error) throw persistenceError('Failed to read texting history', messageResult.error);
      const consent = consentResult.data ? object(consentResult.data, 'Texting consent is invalid.') : undefined;
      return {
        ...(consent ? { consent: {
          status: text(consent.status, 'consentStatus') as TextingConsentStatus,
          useCase: text(consent.use_case, 'useCase'), effectiveAt: text(consent.effective_at, 'effectiveAt'),
          ...(typeof consent.recipient_timezone === 'string' ? { recipientTimeZone: consent.recipient_timezone } : {}),
          ...(typeof consent.timezone_source === 'string' ? { timezoneSource: consent.timezone_source } : {}),
        } } : {}),
        messages: (messageResult.data ?? []).map((value) => {
          const row = object(value, 'Texting message is invalid.');
          return {
            id: text(row.id, 'messageId'), direction: text(row.direction, 'direction') as 'inbound' | 'outbound',
            status: text(row.status, 'messageStatus'), createdAt: text(row.created_at, 'createdAt'),
            ...(typeof row.last_error_category === 'string' ? { errorCategory: row.last_error_category } : {}),
          };
        }),
      };
    },
    async recordConsent(_scope, input) {
      const { data, error } = await client.rpc('record_texting_consent', {
        target_connection_id: input.connectionId, target_contact_id: input.contactId,
        target_contact_point_id: input.contactPointId, target_use_case: input.useCase, target_status: input.status,
        target_collection_method: input.collectionMethod, target_disclosure_version: input.disclosureVersion,
        target_evidence_ref_hash: input.evidenceHash, target_recipient_timezone: input.recipientTimeZone ?? null,
        target_timezone_source: input.timezoneSource ?? null, target_correlation_id: input.correlationId,
        target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to record texting consent', error);
      const result = object(data, 'Texting consent result is invalid.');
      return { noOp: result.noOp === true, canceledJobs: integer(result.canceledJobs ?? 0, 'canceledJobs') };
    },
    async createDraftAndIntent(scope, input) {
      const bodyHash = sha256Hex(input.body);
      const payload = {
        schemaVersion: 'twilio-message-body.v1', draftId: input.draftId, draftVersion: 1,
        body: input.body, bodyHash, recipientPhone: input.recipientPhone,
        recipientPhoneHash: sha256Hex(input.recipientPhone),
        reviewedAliasEpoch: input.reviewedAliasEpoch,
        connectionId: input.connectionId,
      };
      const envelope = encryptConnectorSecret(JSON.stringify(payload), {
        workspaceId: scope.workspaceId, connectionId: input.connectionId, provider: 'twilio',
        secretType: 'twilio-message-body', recordVersion: 1,
      }, createEnvironmentKekResolver());
      const created = await client.rpc('create_twilio_message_draft', {
        target_connection_id: input.connectionId, target_draft_id: input.draftId,
        target_contact_id: input.contactId, target_contact_point_id: input.contactPointId,
        target_use_case: input.useCase, target_body_hash: bodyHash, target_content_envelope: envelopeJson(envelope),
        target_correlation_id: input.correlationId, target_occurred_at: input.occurredAt,
      });
      if (created.error) throw persistenceError('Failed to create texting draft', created.error);
      const createdResult = object(created.data, 'Texting draft result is invalid.');
      const draft = object(createdResult.draft, 'Texting draft is invalid.');
      const version = object(createdResult.version, 'Texting draft version is invalid.');
      const policyResult = await client.from('connector_automation_policies').select('id,version')
        .eq('workspace_id', scope.workspaceId).eq('action_type', 'message.send')
        .eq('approval_mode', 'owner_required').order('version', { ascending: false }).limit(1).maybeSingle();
      if (policyResult.error) throw persistenceError('Failed to read texting approval policy', policyResult.error);
      if (!policyResult.data) throw new ConnectorError('configuration-required', 'Texting approval policy is not initialized.');
      const policy = object(policyResult.data, 'Texting connector policy is invalid.');
      const prepared = await client.rpc('prepare_twilio_message_send_intent', {
        target_draft_id: input.draftId, target_expected_draft_version: 1,
        target_connector_policy_id: text(policy.id, 'policyId'),
        target_connector_policy_version: integer(policy.version, 'policyVersion', 1),
        target_summary: input.summary, target_correlation_id: input.correlationId,
      });
      if (prepared.error) throw persistenceError('Failed to prepare texting intent', prepared.error);
      const preparedResult = object(prepared.data, 'Texting intent result is invalid.');
      const intent = object(preparedResult.intent, 'Texting intent is invalid.');
      return {
        draftId: text(draft.id, 'draftId'), draftVersion: integer(version.version, 'draftVersion', 1),
        intentId: text(intent.id, 'intentId'), intentVersion: integer(intent.current_version, 'intentVersion', 1),
      };
    },
    async approvePreparedIntent(scope, input) {
      const versionResult = await client.from('connector_action_intent_versions')
        .select('id,payload_hash').eq('workspace_id', scope.workspaceId).eq('intent_id', input.intentId)
        .eq('version', input.intentVersion).single();
      if (versionResult.error) throw persistenceError('Failed to read texting intent version', versionResult.error);
      const intentVersion = object(versionResult.data, 'Texting intent version is invalid.');
      if (text(intentVersion.payload_hash, 'payloadHash') !== input.payloadHash) {
        throw new ConnectorError('conflict', 'Texting intent payload changed before approval.');
      }
      const draftVersionResult = await client.from('texting_message_draft_versions')
        .select('texting_policy_id,texting_policy_version,consent_event_id')
        .eq('workspace_id', scope.workspaceId).eq('connector_intent_version_id', text(intentVersion.id, 'intentVersionId')).single();
      if (draftVersionResult.error) throw persistenceError('Failed to read texting draft authority', draftVersionResult.error);
      const draftVersion = object(draftVersionResult.data, 'Texting draft authority is invalid.');
      const [policyResult, consentResult] = await Promise.all([
        client.from('twilio_compliance_policies')
          .select('quiet_hours_start,quiet_hours_end,unknown_timezone_action,default_defer_minutes')
          .eq('workspace_id', scope.workspaceId).eq('id', text(draftVersion.texting_policy_id, 'textingPolicyId'))
          .eq('version', integer(draftVersion.texting_policy_version, 'textingPolicyVersion', 1)).single(),
        client.from('texting_consent_events').select('recipient_timezone,timezone_source')
          .eq('workspace_id', scope.workspaceId).eq('id', text(draftVersion.consent_event_id, 'consentEventId')).single(),
      ]);
      if (policyResult.error) throw persistenceError('Failed to read texting quiet-hours policy', policyResult.error);
      if (consentResult.error) throw persistenceError('Failed to read texting consent evidence', consentResult.error);
      const policy = object(policyResult.data, 'Texting quiet-hours policy is invalid.');
      const consent = object(consentResult.data, 'Texting consent evidence is invalid.');
      const evaluatedAt = new Date(input.evaluatedAt);
      if (!Number.isFinite(evaluatedAt.getTime())) throw new ConnectorError('invalid-input', 'Texting approval time is invalid.');
      const recipientTimeZone = typeof consent.recipient_timezone === 'string' ? consent.recipient_timezone : undefined;
      const timezoneSource = typeof consent.timezone_source === 'string' ? consent.timezone_source : undefined;
      let quietHoursDecision: 'send_now' | 'defer';
      let scheduledAt = evaluatedAt;
      if (!recipientTimeZone || !timezoneSource) {
        if (policy.unknown_timezone_action !== 'defer') {
          throw new ConnectorError('conflict', 'A verified recipient timezone is required before texting approval.');
        }
        quietHoursDecision = 'defer';
        scheduledAt = new Date(evaluatedAt.getTime()
          + integer(policy.default_defer_minutes, 'defaultDeferMinutes', 1) * 60_000);
      } else {
        const decision = evaluateTextingQuietHours({
          startLocal: text(policy.quiet_hours_start, 'quietHoursStart').slice(0, 5),
          endLocal: text(policy.quiet_hours_end, 'quietHoursEnd').slice(0, 5),
          recipientTimeZone, policyVersion: String(draftVersion.texting_policy_version),
        }, evaluatedAt);
        quietHoursDecision = decision.allowed ? 'send_now' : 'defer';
        if (!decision.allowed) {
          scheduledAt = nextAllowedTextingTime({
            startLocal: text(policy.quiet_hours_start, 'quietHoursStart').slice(0, 5),
            endLocal: text(policy.quiet_hours_end, 'quietHoursEnd').slice(0, 5),
            recipientTimeZone,
            policyVersion: String(draftVersion.texting_policy_version),
          }, evaluatedAt);
        }
      }
      const { data, error } = await client.rpc('approve_and_enqueue_twilio_message_send', {
        target_intent_id: input.intentId, target_expected_intent_version: input.intentVersion,
        target_payload_hash: input.payloadHash, target_idempotency_key: input.idempotencyKey,
        target_recipient_timezone: recipientTimeZone ?? null, target_timezone_source: timezoneSource ?? null,
        target_quiet_hours_decision: quietHoursDecision, target_evaluated_at: evaluatedAt.toISOString(),
        target_scheduled_at: scheduledAt.toISOString(), target_correlation_id: input.correlationId,
      });
      if (error) throw persistenceError('Failed to approve texting send', error);
      const result = object(data, 'Texting approval result is invalid.');
      return { jobId: text(object(result.job, 'Texting job is invalid.').id, 'jobId'), noOp: result.noOp === true };
    },
    async requestRealNumberUat(scope, input) {
      if (scope.role !== 'owner') throw new ConnectorError('forbidden', 'Only the workspace owner can request real-number UAT.');
      const body = parseTextMessageBody(input.body);
      const phone = parseE164Phone(input.recipientPhone);
      const bodyHash = sha256Hex(body);
      const evaluatedAt = new Date(Math.floor(new Date(input.occurredAt).getTime() / 60_000) * 60_000);
      if (!Number.isFinite(evaluatedAt.getTime())) throw new ConnectorError('invalid-input', 'Twilio UAT time is invalid.');
      const policyResult = await client.from('twilio_compliance_policies')
        .select('quiet_hours_start,quiet_hours_end,unknown_timezone_action,default_defer_minutes')
        .eq('workspace_id', scope.workspaceId).eq('connection_id', input.connectionId)
        .is('superseded_at', null).single();
      if (policyResult.error) throw persistenceError('Failed to read Twilio UAT quiet-hours policy', policyResult.error);
      const policy = object(policyResult.data, 'Twilio UAT policy is invalid.');
      let quietHoursDecision: 'send_now' | 'defer';
      let scheduledAt = evaluatedAt;
      if (!input.recipientTimeZone || !input.timezoneSource) {
        if (policy.unknown_timezone_action !== 'defer') {
          throw new ConnectorError('conflict', 'A verified recipient timezone is required for real-number UAT.');
        }
        quietHoursDecision = 'defer';
        scheduledAt = new Date(evaluatedAt.getTime() + integer(policy.default_defer_minutes, 'defaultDeferMinutes', 1) * 60_000);
      } else {
        const hours = { startLocal: text(policy.quiet_hours_start, 'quietHoursStart').slice(0, 5),
          endLocal: text(policy.quiet_hours_end, 'quietHoursEnd').slice(0, 5),
          recipientTimeZone: input.recipientTimeZone, policyVersion: 'uat' };
        const decision = evaluateTextingQuietHours(hours, evaluatedAt);
        quietHoursDecision = decision.allowed ? 'send_now' : 'defer';
        if (!decision.allowed) scheduledAt = nextAllowedTextingTime(hours, evaluatedAt);
      }
      const payload = { schemaVersion: 'twilio-message-body.v1', draftId: randomUUID(), draftVersion: 1,
        body, bodyHash, recipientPhone: phone, recipientPhoneHash: sha256Hex(phone), connectionId: input.connectionId };
      const encrypted = encryptConnectorSecret(JSON.stringify(payload), { workspaceId: scope.workspaceId,
        connectionId: input.connectionId, provider: 'twilio', secretType: 'twilio-message-body', recordVersion: 1 },
      createEnvironmentKekResolver());
      const idempotencyKey = `uat:${stablePayloadHash({ connectionId: input.connectionId,
        contactPointId: input.contactPointId, bodyHash, evaluatedAt: evaluatedAt.toISOString() })}`;
      const { data, error } = await client.rpc('request_twilio_real_number_uat', {
        target_connection_id: input.connectionId, target_contact_id: input.contactId,
        target_contact_point_id: input.contactPointId, target_body_hash: bodyHash,
        target_content_envelope: envelopeJson(encrypted), target_recipient_timezone: input.recipientTimeZone ?? null,
        target_timezone_source: input.timezoneSource ?? null, target_quiet_hours_decision: quietHoursDecision,
        target_evaluated_at: evaluatedAt.toISOString(), target_scheduled_at: scheduledAt.toISOString(),
        target_idempotency_key: idempotencyKey, target_correlation_id: randomUUID(),
      });
      if (error) throw persistenceError('Failed to request Twilio real-number UAT', error);
      const result = object(data, 'Twilio UAT request result is invalid.');
      return { jobId: text(object(result.job, 'Twilio UAT job is invalid.').id, 'jobId'), noOp: result.noOp === true };
    },
    async disable(_scope, input) {
      const { data, error } = await client.rpc('disable_twilio_connection', {
        target_connection_id: input.connectionId, target_destroy_send_credentials: input.destroySendCredentials,
        target_correlation_id: input.correlationId, target_occurred_at: input.occurredAt,
      });
      if (error) throw persistenceError('Failed to disable Twilio', error);
      const result = object(data, 'Twilio disable result is invalid.');
      return {
        canceledJobs: integer(result.canceledJobs ?? 0, 'canceledJobs'),
        destroyedSecrets: integer(result.destroyedSecrets ?? 0, 'destroyedSecrets'), noOp: result.noOp === true,
      };
    },
  };
}
