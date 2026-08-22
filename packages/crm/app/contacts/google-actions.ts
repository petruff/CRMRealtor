'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { createGoogleEmailDraft, prepareGoogleEmailDraftIntent } from '@/lib/data/google-draft-repository';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { GoogleEmailActionState } from '@/app/contacts/action-state';

export async function prepareGoogleEmailAction(
  _state: GoogleEmailActionState,
  formData: FormData,
): Promise<GoogleEmailActionState> {
  try {
    const context = await getRepository();
    if (!context.isLive) return { status: 'error', message: 'Gmail send is available only in a connected live workspace.' };
    const contactId = String(formData.get('contactId') ?? '');
    const connectionId = String(formData.get('connectionId') ?? '');
    const draftId = randomUUID();
    const correlationId = randomUUID();
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
    console.error('[google-email-action] operation-failed');
    return { status: 'error', message: error instanceof Error ? error.message : 'The email was not prepared.' };
  }
}
