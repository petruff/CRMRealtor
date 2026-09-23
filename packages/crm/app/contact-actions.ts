'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addContactNoteCommand,
  archiveContactNoteCommand,
  createContactCommand,
  editContactNoteCommand,
  isContactCommandError,
  recordContactTouchCommand,
  restoreContactNoteCommand,
  updateContactCommand,
} from '@/lib/application/contact-commands';
import type { ContactActionState } from '@/lib/application/contact-action-state';
import { getRepository } from '@/lib/data';
import { randomUUID } from 'node:crypto';
import {
  contactEditHref,
  contactRecordHref,
  type ContactBrowseContext,
} from '@/lib/application/contact-navigation';

function formValues(formData?: FormData): Record<string, string> | undefined {
  if (!formData) return undefined;
  const values: Record<string, string> = {};
  for (const [key, entry] of formData.entries()) {
    if (typeof entry === 'string') values[key] = entry;
  }
  return values;
}

function actionError(
  error: unknown,
  operation: string,
  formData?: FormData,
): ContactActionState {
  const values = formValues(formData);
  if (isContactCommandError(error)) {
    return {
      status: 'error',
      message: error.message,
      fieldErrors: error.fieldErrors,
      values,
    };
  }

  console.error(`[contact-action:${operation}]`, error);
  return {
    status: 'error',
    message: operation === 'update'
      ? "We couldn't confirm the complete update. Refresh this contact before trying again."
      : "We couldn't save that change. Nothing was updated — please try again.",
    values,
  };
}

function revalidateContact(id: string) {
  revalidatePath('/');
  revalidatePath('/contacts');
  revalidatePath('/activities');
  revalidatePath('/alerts');
  revalidatePath(`/contacts/${id}`);
}

export async function createContactAction(
  _state: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  let id: string;
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const contact = await createContactCommand(repository, formData, new Date(), {
      repository: activityRepository,
      scope: workspaceScope,
    });
    id = contact.id;
  } catch (error) {
    return actionError(error, 'create', formData);
  }

  revalidateContact(id);
  redirect(`/contacts/${encodeURIComponent(id)}?saved=created`);
}

export async function updateContactAction(
  id: string,
  navigation: Readonly<{ context: ContactBrowseContext; nextContactId?: string }>,
  _state: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  void _state;
  let destination = contactRecordHref(id, navigation.context, 'updated');
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    await updateContactCommand(repository, id, formData, new Date(), {
      repository: activityRepository,
      scope: workspaceScope,
    });
    if (formData.get('reviewAction') === 'save-next' && navigation.nextContactId) {
      const nextContact = await repository.get(navigation.nextContactId);
      if (nextContact && !nextContact.archivedAt) {
        destination = contactEditHref(nextContact.id, navigation.context);
      }
    }
  } catch (error) {
    return actionError(error, 'update', formData);
  }

  revalidateContact(id);
  redirect(destination);
}

export async function addContactNoteAction(
  id: string,
  _state: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    await addContactNoteCommand(repository, id, formData, new Date(), {
      repository: activityRepository,
      scope: workspaceScope,
    });
  } catch (error) {
    return actionError(error, 'add-note', formData);
  }

  revalidateContact(id);
  redirect(`/contacts/${encodeURIComponent(id)}?saved=note#notes`);
}

export async function archiveContactNoteAction(
  contactId: string,
  noteId: string,
  _state: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const { repository } = await getRepository();
    await archiveContactNoteCommand(repository, contactId, noteId, formData, randomUUID());
  } catch (error) {
    return actionError(error, 'archive-note', formData);
  }
  revalidateContact(contactId);
  redirect(`/contacts/${encodeURIComponent(contactId)}?saved=note-archived#notes`);
}

export async function editContactNoteAction(
  contactId: string,
  noteId: string,
  _state: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  void _state;
  try {
    const { repository } = await getRepository();
    const result = await editContactNoteCommand(repository, contactId, noteId, formData, randomUUID());
    revalidateContact(contactId);
    return {
      status: 'success',
      message: result.noOp ? 'No changes to save.' : 'Note updated.',
    };
  } catch (error) {
    // Refresh the page data so a conflict shows the latest saved text beside the kept draft.
    revalidateContact(contactId);
    return actionError(error, 'edit-note', formData);
  }
}

export async function restoreContactNoteAction(
  contactId: string,
  noteId: string,
  _state: ContactActionState,
  _formData: FormData,
): Promise<ContactActionState> {
  void _state;
  void _formData;
  try {
    const { repository } = await getRepository();
    await restoreContactNoteCommand(repository, contactId, noteId, randomUUID());
  } catch (error) {
    return actionError(error, 'restore-note');
  }
  revalidateContact(contactId);
  redirect(`/contacts/${encodeURIComponent(contactId)}?saved=note-restored#notes`);
}

export async function recordContactTouchAction(
  id: string,
  _state: ContactActionState,
  _formData: FormData,
): Promise<ContactActionState> {
  void _state;
  void _formData;
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    await recordContactTouchCommand(repository, id, new Date(), {
      repository: activityRepository,
      scope: workspaceScope,
    });
  } catch (error) {
    return actionError(error, 'record-touch');
  }

  revalidateContact(id);
  redirect(`/contacts/${encodeURIComponent(id)}?saved=touch`);
}
