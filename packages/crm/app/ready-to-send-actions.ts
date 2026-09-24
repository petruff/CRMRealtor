'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { isContactCommandError, recordConversationCommand } from '@/lib/application/contact-commands';

export interface MarkSentResult { readonly status: 'sent' | 'error'; readonly message?: string }

/** She sent the text from her phone: log it as a conversation and move the follow-up forward. */
export async function markReadyTextSentAction(contactId: unknown, body: unknown): Promise<MarkSentResult> {
  try {
    if (typeof contactId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(contactId)) return { status: 'error', message: 'Choose a contact first.' };
    const text = typeof body === 'string' ? body.trim().slice(0, 1500) : '';
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const form = new FormData();
    form.set('note', text ? `Texted: ${text}` : 'Texted.');
    form.set('followUp', 'cadence');
    await recordConversationCommand(repository, contactId, form, new Date(), activityRepository ? { repository: activityRepository, scope: workspaceScope } : undefined);
    revalidatePath('/');
    revalidatePath(`/contacts/${contactId}`);
    return { status: 'sent' };
  } catch (error) {
    if (isContactCommandError(error)) return { status: 'error', message: error.message };
    console.error('[ready-to-send:mark-sent]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'That couldn’t be saved. Try again.' };
  }
}
