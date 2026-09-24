'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { appendActivityEventCommand } from '@/lib/application/activity-commands';
import { isContactCommandError, recordConversationCommand } from '@/lib/application/contact-commands';

export interface ReviveResult { readonly status: 'done' | 'error'; readonly message?: string }

const ID = /^[A-Za-z0-9._:-]{1,128}$/u;

/** She sent the email from her own app: log it and start the normal follow-up rhythm. */
export async function markRevivedAction(contactId: unknown, subject: unknown): Promise<ReviveResult> {
  try {
    if (typeof contactId !== 'string' || !ID.test(contactId)) return { status: 'error', message: 'Choose a contact first.' };
    const line = typeof subject === 'string' ? subject.replace(/\s+/gu, ' ').trim().slice(0, 200) : '';
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const form = new FormData();
    form.set('note', line ? `Emailed: ${line}` : 'Emailed.');
    form.set('followUp', 'cadence');
    await recordConversationCommand(repository, contactId, form, new Date(), activityRepository ? { repository: activityRepository, scope: workspaceScope } : undefined);
    revalidatePath('/revive');
    revalidatePath(`/contacts/${contactId}`);
    return { status: 'done' };
  } catch (error) {
    if (isContactCommandError(error)) return { status: 'error', message: error.message };
    console.error('[revive:mark-sent]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'That couldn’t be saved. Try again.' };
  }
}

/** They asked not to be emailed: turn off email for this contact and note why. */
export async function stopEmailsAction(contactId: unknown): Promise<ReviveResult> {
  try {
    if (typeof contactId !== 'string' || !ID.test(contactId)) return { status: 'error', message: 'Choose a contact first.' };
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const contact = await repository.get(contactId);
    if (!contact || contact.archivedAt) return { status: 'error', message: 'This contact is archived or no longer exists.' };
    const now = new Date();
    await repository.update(contact.id, { emailSubscribed: false });
    const note = await repository.addNote(contact.id, 'Asked not to receive emails. Email turned off (Revive old leads).');
    if (activityRepository) {
      const scope = { repository: activityRepository, scope: workspaceScope };
      await appendActivityEventCommand(scope.repository, scope.scope, { type: 'contact-updated', contactId: contact.id, idempotencyKey: `contact-updated:${contact.id}:${now.getTime()}` }, now);
      await appendActivityEventCommand(scope.repository, scope.scope, { type: 'note-added', contactId: contact.id, idempotencyKey: `note-added:${note.id}` }, now);
    }
    revalidatePath('/revive');
    revalidatePath(`/contacts/${contact.id}`);
    return { status: 'done', message: 'Email turned off for this contact.' };
  } catch (error) {
    console.error('[revive:stop-emails]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'That couldn’t be saved. Nothing was changed.' };
  }
}
