import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RepositoryContext } from '../data/index.ts';
import { createGoogleEmailDraft, prepareGoogleEmailDraftIntent } from '../data/google-draft-repository.ts';
import { createGoogleOperationServerRepository } from '../data/google-operation-server-context.ts';
import { createMailchimpServerRepository } from '../data/mailchimp-operation-server-context.ts';
import { supabaseGoogleOperationRepository } from '../data/supabase-google-operation-repository.ts';
import { loadGoogleConfiguredRuntimeConfiguration } from '../config/connector-runtime.ts';
import { ConnectorError } from '../domain/connector.ts';
import { googleEmailReadiness } from './google-email-readiness.ts';
import { prepareGoogleCalendarTaskIntent } from './google-operations.ts';
import { createMailchimpCampaignDraftCommand } from './mailchimp-campaign-service.ts';
import type { OmnixProviderHandoffGateway } from './omnix-provider-proposal-handoff.ts';

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
  context: RepositoryContext,
  authenticated: SupabaseClient,
): OmnixProviderHandoffGateway {
  if (!context.isLive) throw new ConnectorError('forbidden', 'Provider handoff requires a live workspace.');
  return {
    prepare: async (input) => {
      if (input.kind === 'google-email-draft') {
        const contactId = input.contactId ?? stringField(input.payload, 'contactId');
        if (!context.richContactRepository) throw new ConnectorError('configuration-required', 'Contact email records are unavailable.');
        const connection = (await context.connectorRepository.listConnections(context.workspaceScope, {
          provider: 'google', limit: 10,
        })).find((candidate) => ['active', 'degraded'].includes(candidate.status)
          && candidate.grantedScopes.includes('https://www.googleapis.com/auth/gmail.send'));
        if (!connection?.remoteAccountLabel) throw new ConnectorError('configuration-required', 'Connect Gmail before preparing this draft.');
        const points = await context.richContactRepository.listContactPoints(context.workspaceScope, contactId);
        const recipient = points.find((point) => point.type === 'email' && point.isPrimary)
          ?? points.find((point) => point.type === 'email');
        if (!recipient) throw new ConnectorError('not-found', 'Add a contact email before preparing this draft.');
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
        const draftId = randomUUID();
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
        const connection = (await context.connectorRepository.listConnections(context.workspaceScope, {
          provider: 'google', limit: 10,
        })).find((candidate) => ['active', 'degraded'].includes(candidate.status)
          && candidate.grantedScopes.includes('https://www.googleapis.com/auth/calendar.app.created'));
        if (!connection) throw new ConnectorError('configuration-required', 'Connect Google Calendar before preparing this event.');
        const taskId = stringField(input.payload, 'taskId');
        const task = await context.activityRepository.getTask(context.workspaceScope, taskId);
        if (!task?.taskVersion) throw new ConnectorError('conflict', 'The linked task changed or is unavailable.');
        const startAt = typeof input.payload.startAt === 'string' ? input.payload.startAt : task.dueAt;
        const result = await prepareGoogleCalendarTaskIntent(
          context.connectorRepository,
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
