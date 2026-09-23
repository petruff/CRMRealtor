'use server';

import { revalidatePath } from 'next/cache';
import { FOLLOW_UP_CHOICES, isContactCommandError, recordConversationCommand, type FollowUpChoice } from '@/lib/application/contact-commands';
import { callOutcomeNote, parseCallOutcome } from '@/lib/application/call-outcome';
import { getRepository } from '@/lib/data';

export interface CallLogState {
  readonly status: 'idle' | 'saved' | 'error';
  readonly message?: string;
}

/** Logs the call the realtor just made: timeline note, touch and next follow-up. */
export async function logCallOutcomeAction(contactId: string, _state: CallLogState, formData: FormData): Promise<CallLogState> {
  const outcome = parseCallOutcome(formData.get('outcome'));
  if (!outcome) return { status: 'error', message: 'Choose how the call went.' };
  const followUp = String(formData.get('followUp') ?? 'cadence');
  if (!(FOLLOW_UP_CHOICES as readonly string[]).includes(followUp)) return { status: 'error', message: 'Choose when to follow up.' };
  const note = String(formData.get('note') ?? '');
  if (note.length > 2_000) return { status: 'error', message: 'Keep the note under 2,000 characters.' };
  const form = new FormData();
  form.set('note', callOutcomeNote(outcome, note));
  form.set('followUp', followUp as FollowUpChoice);
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    await recordConversationCommand(repository, contactId, form, new Date(), { repository: activityRepository, scope: workspaceScope });
    revalidatePath('/');
    revalidatePath('/contacts');
    revalidatePath(`/contacts/${contactId}`);
    return { status: 'saved' };
  } catch (error) {
    if (isContactCommandError(error)) return { status: 'error', message: error.message };
    console.error('[call-log]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'That didn’t save. Please try again.' };
  }
}
