import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryContext } from '../data/index.ts';
import { createGoogleEmailDraft, prepareGoogleEmailDraftIntent } from '../data/google-draft-repository.ts';
import { createGoogleOperationServerRepository } from '../data/google-operation-server-context.ts';
import { createMailchimpServerRepository } from '../data/mailchimp-operation-server-context.ts';
import { supabaseGoogleOperationRepository } from '../data/supabase-google-operation-repository.ts';
import { loadGoogleConfiguredRuntimeConfiguration } from '../config/connector-runtime.ts';
import { ConnectorError, CONNECTOR_INTENT_STATUSES, stablePayloadHash, type ConnectorIntentStatus } from '../domain/connector.ts';
import { createGoogleRawTextMessage } from '../domain/google-connector.ts';
import { googleEmailReadiness } from './google-email-readiness.ts';
import { prepareGoogleCalendarTaskIntent } from './google-operations.ts';
import { createMailchimpCampaignDraftCommand } from './mailchimp-campaign-service.ts';
import type { OmnixProviderHandoffGateway } from './omnix-provider-proposal-handoff.ts';
import { supabaseContactOutboundGuard } from '../data/supabase-contact-outbound-guard.ts';
import { validateCaptureDraftLanguage } from './capture-outcome-operations.ts';

export function omnixProviderDraftId(proposalId: string, version: number): string {
  const hex = createHash('sha256').update(`omnix-provider-draft:${proposalId}:${version}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function stringField(payload: Readonly<Record<string, unknown>>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) throw new ConnectorError('invalid-input', `${field} is required.`);
  return value.trim();
}

function html(value: string): string {
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#181d26">${value
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;').replaceAll('\n', '<br>')}</div>`;
}

export function createOmnixProviderServerGateway(
  context: Pick<RepositoryContext, 'isLive' | 'workspaceScope' | 'repository' | 'richContactRepository' | 'connectorRepository' | 'activityRepository' | 'userEmail' | 'userDisplayName'>,
  authenticated: SupabaseClient,
): OmnixProviderHandoffGateway {
  if (!context.isLive) throw new ConnectorError('forbidden', 'Provider handoff requires a live workspace.');
  return {
    prepare: async (input) => {
      if (input.payload.targetResolutionRequired === true || input.payload.audienceReviewRequired === true) {
        throw new ConnectorError('invalid-input', 'Review the exact sender, recipient, or audience before preparing this draft.');
      }
      if (input.payload.captureExactTarget === true) {
        // Recover durable preparation before freshness checks. Reading an existing intent is not another handoff.
        if (input.kind === 'google-calendar-event') {
          const taskId = stringField(input.payload, 'taskId');
          const resourceKey = stablePayloadHash({ workspaceId: context.workspaceScope.workspaceId, taskId });
          const expectedHash = stablePayloadHash({ schemaVersion: 'google-calendar-task.v1', taskId, taskVersion: input.payload.taskVersion,
            resourceKey, title: input.payload.title, startAt: input.payload.startAt, endAt: input.payload.endAt, timeZone: input.payload.timeZone, eventId: resourceKey.slice(0, 32) });
          const { data, error } = await authenticated.from('capture_calendar_intent_receipts').select('intent_id,payload_hash')
            .eq('workspace_id', context.workspaceScope.workspaceId).eq('proposal_id', input.proposalId).eq('proposal_version', input.version).maybeSingle();
          if (error) throw new ConnectorError('conflict', 'Calendar receipt recovery is unavailable.');
          if (data) {
            if (data.payload_hash !== expectedHash) throw new ConnectorError('conflict', 'Calendar receipt does not match this approval.');
            return { executionReference: `connector-intent:${data.intent_id}` };
          }
        } else if (input.kind === 'google-email-draft') {
          const draftId = omnixProviderDraftId(input.proposalId, input.version);
          const clientMessageId = `${stablePayloadHash({ workspaceId: context.workspaceScope.workspaceId, connectionId: input.payload.connectionId, draftId })}@omnix.local`;
          const recipient = stringField(input.payload, 'recipient');
          const expectedHash = stablePayloadHash({ schemaVersion: 'google-gmail-send.v1', contactId: input.contactId,
            contactPointId: input.payload.contactPointId, normalizedRecipient: recipient.trim().toLowerCase(), clientMessageId,
            rawMessageBase64Url: createGoogleRawTextMessage({ from: stringField(input.payload, 'sender'), to: recipient, subject: stringField(input.payload, 'subject'), body: stringField(input.payload, 'body'), clientMessageId }) });
          const { data, error } = await authenticated.from('google_email_drafts').select('current_version,current_payload_hash,status,prepared_intent_id,sent_job_id')
            .eq('workspace_id', context.workspaceScope.workspaceId).eq('id', draftId).maybeSingle();
          if (error) throw new ConnectorError('conflict', 'Gmail receipt recovery is unavailable.');
          if ((data?.status === 'intent-prepared' && data.prepared_intent_id) || (data?.status === 'sent' && data.sent_job_id)) {
            if (data.current_version !== 1 || data.current_payload_hash !== expectedHash) throw new ConnectorError('conflict', 'The prepared draft no longer matches this approval.');
            if (data.status === 'sent') {
              const { data: job, error: jobError } = await authenticated.from('connector_jobs').select('intent_id')
                .eq('workspace_id', context.workspaceScope.workspaceId).eq('id', data.sent_job_id).maybeSingle();
              if (jobError || !job?.intent_id) throw new ConnectorError('conflict', 'The sent draft receipt is unavailable.');
              return { executionReference: `connector-intent:${job.intent_id}` };
            }
            return { executionReference: `connector-intent:${data.prepared_intent_id}` };
          }
        }
      }
      if (input.kind === 'google-email-draft') {
        const contactId = input.contactId ?? stringField(input.payload, 'contactId');
        if (!context.richContactRepository) throw new ConnectorError('configuration-required', 'Contact email records are unavailable.');
        const exact = input.payload.captureExactTarget === true;
        const connection = (await context.connectorRepository.listConnections(context.workspaceScope, {
          provider: 'google', limit: 20,
        })).find((candidate) => ['active', 'degraded'].includes(candidate.status)
          && (!exact || candidate.id === input.payload.connectionId)
          && candidate.grantedScopes.includes('https://www.googleapis.com/auth/gmail.send'));
        if (!connection?.remoteAccountLabel) throw new ConnectorError('configuration-required', 'Connect Gmail before preparing this draft.');
        const points = await context.richContactRepository.listContactPoints(context.workspaceScope, contactId);
        const recipient = exact ? points.find((point) => point.id === input.payload.contactPointId && point.type === 'email' && !point.archivedAt)
          : points.find((point) => point.type === 'email' && point.isPrimary) ?? points.find((point) => point.type === 'email');
        if (!recipient) throw new ConnectorError('not-found', 'Add a contact email before preparing this draft.');
        if (exact) {
          const contact = await context.repository.get(contactId);
          if (!contact || contact.archivedAt || contact.emailSubscribed !== true || recipient.emailSubscribed === false) throw new ConnectorError('forbidden', 'The selected recipient is suppressed or unavailable.');
          if (recipient.normalizedValue !== input.payload.recipient || recipient.updatedAt !== input.payload.contactPointVersion
            || connection.remoteAccountLabel !== input.payload.sender || connection.updatedAt !== input.payload.connectionVersion) throw new ConnectorError('conflict', 'The approved sender or recipient changed. Create a fresh review.');
          await supabaseContactOutboundGuard(authenticated).assertTarget(context.workspaceScope, contactId, recipient.id);
          validateCaptureDraftLanguage(`${stringField(input.payload, 'subject')}\n${stringField(input.payload, 'body')}`);
        }
        const operations = supabaseGoogleOperationRepository({ authenticated });
        let readiness = googleEmailReadiness(await operations.readCapabilityState(context.workspaceScope, connection.id));
        if (!readiness.ready) {
          readiness = googleEmailReadiness(await operations.repairCapabilityState(
            context.workspaceScope, connection.id, input.occurredAt,
          ));
        }
        if (!readiness.ready) throw new ConnectorError(
          'configuration-required', readiness.message ?? 'Gmail needs attention before this draft can be prepared.',
        );
        const draftId = omnixProviderDraftId(input.proposalId, input.version);
        await createGoogleEmailDraft({
          database: authenticated, scope: context.workspaceScope, connectionId: connection.id,
          contactId, contactPointId: recipient.id, from: connection.remoteAccountLabel,
          to: recipient.normalizedValue, subject: stringField(input.payload, 'subject'),
          body: stringField(input.payload, 'body'), correlationId: input.correlationId,
          draftId, occurredAt: input.occurredAt,
        });
        const prepared = await prepareGoogleEmailDraftIntent({
          database: authenticated, draftId, expectedVersion: 1,
          summary: `Send reviewed Omnix email draft to contact ${contactId}.`,
          correlationId: input.correlationId, occurredAt: input.occurredAt,
        });
        return { executionReference: `connector-intent:${prepared.intent.id}` };
      }
      if (input.kind === 'google-calendar-event') {
        const exact = input.payload.captureExactTarget === true;
        const connection = (await context.connectorRepository.listConnections(context.workspaceScope, {
          provider: 'google', limit: 20,
        })).find((candidate) => ['active', 'degraded'].includes(candidate.status)
          && (!exact || candidate.id === input.payload.connectionId)
          && candidate.grantedScopes.includes('https://www.googleapis.com/auth/calendar.app.created'));
        if (!connection) throw new ConnectorError('configuration-required', 'Connect Google Calendar before preparing this event.');
        const taskId = stringField(input.payload, 'taskId');
        const task = await context.activityRepository.getTask(context.workspaceScope, taskId);
        if (!task?.taskVersion) throw new ConnectorError('conflict', 'The linked task changed or is unavailable.');
        if (exact && (task.contactId !== input.contactId || task.taskVersion !== input.payload.taskVersion || task.title !== input.payload.title || task.status !== 'open' || connection.updatedAt !== input.payload.connectionVersion)) throw new ConnectorError('conflict', 'The approved task or calendar connection changed. Create a fresh review.');
        const startAt = typeof input.payload.startAt === 'string' ? input.payload.startAt : task.dueAt;
        const calendarConnectors = exact ? {
          ...context.connectorRepository,
          createIntent: async (...args: Parameters<typeof context.connectorRepository.createIntent>) => {
            const [scope, command] = args;
            const { data, error } = await authenticated.rpc('create_capture_calendar_intent', {
              target_proposal_id: input.proposalId, target_proposal_version: input.version,
              target_connection_id: command.connectionId, target_summary: command.summary,
              target_payload_ref: command.payloadReference, target_payload_hash: command.payloadHash,
              target_policy_id: command.policyId, target_policy_version: command.policyVersion,
              target_compliance_snapshot: command.complianceSnapshot ?? {}, target_correlation_id: input.correlationId,
            });
            if (error || !data?.intent?.id) throw new ConnectorError('conflict', 'Calendar preparation could not recover its canonical receipt.');
            const row = data.intent as Record<string, unknown>;
            if (!CONNECTOR_INTENT_STATUSES.includes(row.state as ConnectorIntentStatus)) throw new ConnectorError('conflict', 'Calendar intent receipt is invalid.');
            return { id: String(row.id), workspaceId: scope.workspaceId, provider: 'google' as const,
              connectionId: command.connectionId, actionType: command.actionType, version: Number(row.current_version),
              payloadReference: command.payloadReference, payloadHash: command.payloadHash, summary: String(row.summary),
              status: row.state as ConnectorIntentStatus, requestedByMembershipId: String(row.created_by_membership_id),
              createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
          },
        } : context.connectorRepository;
        const result = await prepareGoogleCalendarTaskIntent(
          calendarConnectors,
          createGoogleOperationServerRepository({ authenticated }),
          loadGoogleConfiguredRuntimeConfiguration(),
          context.workspaceScope,
          {
            connectionId: connection.id, taskId: task.id, taskVersion: task.taskVersion,
            title: task.title, startAt,
            endAt: typeof input.payload.endAt === 'string'
              ? input.payload.endAt : new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
            timeZone: typeof input.payload.timeZone === 'string'
              ? input.payload.timeZone : process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
            correlationId: input.correlationId,
          },
        );
        return { executionReference: `connector-intent:${result.id}` };
      }
      const connection = (await context.connectorRepository.listConnections(context.workspaceScope, {
        provider: 'mailchimp', limit: 10,
      })).find((candidate) => ['active', 'degraded'].includes(candidate.status));
      if (!connection) throw new ConnectorError('configuration-required', 'Connect Mailchimp before preparing this campaign.');
      const replyTo = context.userEmail ?? connection.remoteAccountLabel;
      if (!replyTo) throw new ConnectorError('configuration-required', 'A verified reply-to email is required.');
      const title = stringField(input.payload, 'title');
      const message = stringField(input.payload, 'message');
      const segmentValue = typeof input.payload.segment === 'string' ? input.payload.segment : 'all-subscribers';
      const campaign = await createMailchimpCampaignDraftCommand({
        repository: createMailchimpServerRepository({ authenticated }).campaigns,
        scope: context.workspaceScope, connectionId: connection.id,
        segment: segmentValue === 'all-subscribers'
          ? { kind: 'all-subscribers' }
          : { kind: 'lead-type', value: segmentValue as 'hot' | 'warm' | 'nurture' },
        content: {
          title, subject: title.slice(0, 150), previewText: message.slice(0, 150),
          fromName: context.userDisplayName ?? 'Omnix CRM', replyTo,
          plainText: message, html: html(message),
        },
        correlationId: input.correlationId,
      });
      return { executionReference: `mailchimp-draft:${campaign.id}` };
    },
  };
}
