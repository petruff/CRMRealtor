'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { createGoogleEmailDraft, prepareGoogleEmailDraftIntent } from '@/lib/data/google-draft-repository';
import { supabaseGoogleOperationRepository } from '@/lib/data/supabase-google-operation-repository';
import { googleEmailReadiness } from '@/lib/application/google-email-readiness';
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
    await prepareGoogleEmailDraftIntent({ database: authenticated, draftId, expectedVersion: 1,
      summary: `Send reviewed email to contact ${contactId}.`, correlationId, occurredAt });
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/connections');
    return { status: 'success', message: 'Email prepared. The workspace owner must approve it before Gmail sends anything.' };
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
