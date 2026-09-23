'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { createGoogleEmailDraft, prepareGoogleEmailDraftIntent } from '@/lib/data/google-draft-repository';
import { supabaseGoogleOperationRepository } from '@/lib/data/supabase-google-operation-repository';
import { googleEmailReadiness } from '@/lib/application/google-email-readiness';
import { approveConnectorIntentCommand } from '@/lib/application/connector-commands';
import { drainConfiguredConnectorServiceJobs } from '@/lib/application/connector-service-worker';
import { ConnectorError } from '@/lib/domain/connector';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { GoogleEmailActionState } from '@/app/contacts/action-state';

export async function prepareGoogleEmailAction(
  _state: GoogleEmailActionState,
  formData: FormData,
): Promise<GoogleEmailActionState> {
  const correlationId = randomUUID();
  const supportReference = correlationId.replaceAll('-', '').slice(0, 8).toUpperCase();
  try {
    const context = await getRepository();
    if (!context.isLive) return { status: 'error', message: 'Gmail send is available only in a connected live workspace.' };
    const contactId = String(formData.get('contactId') ?? '');
    const connectionId = String(formData.get('connectionId') ?? '');
    const draftId = randomUUID();
    const occurredAt = new Date().toISOString();
    const connection = (await context.connectorRepository.listConnections(context.workspaceScope, {
      provider: 'google', limit: 10,
    })).find((candidate) => candidate.id === connectionId
      && ['active', 'degraded'].includes(candidate.status)
      && candidate.grantedScopes.includes('https://www.googleapis.com/auth/gmail.send'));
    if (!connection?.remoteAccountLabel) {
      return { status: 'error', message: 'The exact connected Gmail account is unavailable or needs reauthorization.' };
    }
    const authenticated = await createSupabaseServerClient();
    const operations = supabaseGoogleOperationRepository({ authenticated });
    let readiness = googleEmailReadiness(
      await operations.readCapabilityState(context.workspaceScope, connectionId),
    );
    if (!readiness.ready && connection.grantedScopes.includes('https://www.googleapis.com/auth/gmail.send')) {
      readiness = googleEmailReadiness(
        await operations.repairCapabilityState(context.workspaceScope, connectionId, occurredAt),
      );
    }
    if (!readiness.ready) {
      return { status: 'error', message: `${readiness.message} Support reference: ${supportReference}.` };
    }
    await createGoogleEmailDraft({
      database: authenticated, scope: context.workspaceScope, connectionId, contactId,
      contactPointId: String(formData.get('contactPointId') ?? ''),
      from: connection.remoteAccountLabel, to: String(formData.get('to') ?? ''),
      subject: String(formData.get('subject') ?? ''), body: String(formData.get('body') ?? ''),
      correlationId, draftId, occurredAt,
    });
    const prepared = await prepareGoogleEmailDraftIntent({ database: authenticated, draftId, expectedVersion: 1,
      summary: `Send reviewed email to contact ${contactId}.`, correlationId, occurredAt });
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/connections');
    return {
      status: 'success', phase: 'draft-ready',
      message: context.workspaceScope.role === 'owner'
        ? 'Draft ready. Review the recipient and subject, then approve the exact email.'
        : 'Draft ready and waiting for the workspace owner. Nothing has been sent.',
      intentId: prepared.intent.id,
      intentVersion: prepared.intent.current_version,
      recipient: String(formData.get('to') ?? ''),
      subject: String(formData.get('subject') ?? ''),
    };
  } catch (error) {
    const category = error instanceof ConnectorError ? error.code : 'internal-error';
    console.error('[google-email-action] operation-failed', { category, supportReference });
    const message = category === 'forbidden'
      ? 'The saved contact email could not be verified. Refresh the contact and try again.'
      : category === 'invalid-input'
        ? 'Gmail setup is not fully ready for this contact. Open Connections and finish Google setup.'
        : category === 'not-found'
          ? 'The Google connection is no longer ready. Reconnect it from Connections.'
          : 'The email draft could not be prepared. Nothing was sent.';
    return { status: 'error', message: `${message} Support reference: ${supportReference}.` };
  }
}

export async function approveAndSendGoogleEmailAction(
  _state: GoogleEmailActionState,
  formData: FormData,
): Promise<GoogleEmailActionState> {
  const correlationId = randomUUID();
  const supportReference = correlationId.replaceAll('-', '').slice(0, 8).toUpperCase();
  try {
    const context = await getRepository();
    if (!context.isLive) return { status: 'error', message: 'Sign in to approve this email.' };
    const intentId = String(formData.get('intentId') ?? '');
    const intentVersion = Number(formData.get('intentVersion'));
    if (formData.get('confirmed') !== 'yes') {
      return { status: 'error', message: 'Review and confirm the exact recipient and subject before sending.' };
    }
    const approved = await approveConnectorIntentCommand(
      context.connectorRepository,
      context.workspaceScope,
      {
        intentId,
        expectedVersion: intentVersion,
        idempotencyKey: `contact-email:${intentId}:${intentVersion}`,
        correlationId,
      },
    );

    let job = approved.job;
    try {
      await drainConfiguredConnectorServiceJobs(process.env);
      job = await context.connectorRepository.getJob(context.workspaceScope, approved.job.id) ?? approved.job;
    } catch (error) {
      console.error('[google-email-action] immediate-drain-deferred', {
        category: error instanceof ConnectorError ? error.code : 'internal-error',
        supportReference,
      });
    }

    revalidatePath('/connections');
    if (job.state === 'succeeded') {
      return { status: 'success', phase: 'sent', message: 'Sent with Gmail. The delivery record is now saved in Omnix.' };
    }
    if (job.state === 'reconciliation-required') {
      return {
        status: 'success', phase: 'queued',
        message: `Gmail received the request, but Omnix is verifying the final delivery status. Do not resend. Support reference: ${supportReference}.`,
      };
    }
    return {
      status: 'success', phase: 'queued',
      message: 'Approved and securely queued. Omnix will send it once and update the connection activity.',
    };
  } catch (error) {
    const category = error instanceof ConnectorError ? error.code : 'internal-error';
    console.error('[google-email-action] approval-failed', { category, supportReference });
    const message = category === 'forbidden'
      ? 'Only the workspace owner can approve and send this email.'
      : category === 'conflict'
        ? 'This draft changed or was already handled. Refresh the contact before trying again.'
        : 'The email could not be approved. Nothing new was sent.';
    return { status: 'error', message: `${message} Support reference: ${supportReference}.` };
  }
}
