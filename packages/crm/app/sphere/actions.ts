'use server';

import { revalidatePath } from 'next/cache';
import { isContactCommandError, recordConversationCommand } from '@/lib/application/contact-commands';
import { getRepository } from '@/lib/data';

export interface SentState {
  readonly status: 'idle' | 'sent' | 'error';
  readonly message?: string;
}

const KIND_LABEL: Record<string, string> = {
  homeaversary: 'home anniversary message',
  birthday: 'birthday message',
  'check-in': 'check-in message',
  'thank-you': 'referral thank-you',
};
const CHANNEL_LABEL: Record<string, string> = { text: 'by text', email: 'by email', other: '' };

/** Logs a personal sphere message as a conversation so cadence and Today stay honest. */
export async function markSphereMessageSentAction(contactId: string, _state: SentState, formData: FormData): Promise<SentState> {
  const kind = String(formData.get('kind') ?? '');
  const channel = String(formData.get('channel') ?? 'other');
  if (!KIND_LABEL[kind] || !(channel in CHANNEL_LABEL)) return { status: 'error', message: 'Choose what you sent.' };
  const language = formData.get('language') === 'es' ? ' (Spanish)' : '';
  const note = `Sent ${KIND_LABEL[kind]}${CHANNEL_LABEL[channel] ? ` ${CHANNEL_LABEL[channel]}` : ''}${language}.`;
  const form = new FormData();
  form.set('note', note);
  form.set('followUp', 'cadence');
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    await recordConversationCommand(repository, contactId, form, new Date(), { repository: activityRepository, scope: workspaceScope });
    revalidatePath('/sphere');
    revalidatePath('/');
    return { status: 'sent' };
  } catch (error) {
    if (isContactCommandError(error)) return { status: 'error', message: error.message };
    console.error('[sphere:mark-sent]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'That didn’t save. Please try again.' };
  }
}
