'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addContactPointCommand,
  addHouseholdMemberCommand,
  addPersonRelationshipCommand,
  archiveContactCommand,
  archiveContactPointCommand,
  archiveCustomFieldDefinitionCommand,
  archiveHouseholdCommand,
  archivePersonRelationshipCommand,
  assignContactCommand,
  createCustomFieldDefinitionCommand,
  createHouseholdCommand,
  listCustomFieldDefinitionsCommand,
  removeHouseholdMemberCommand,
  restoreContactCommand,
  restoreContactPointCommand,
  restorePersonRelationshipCommand,
  setContactCustomFieldValueCommand,
  unassignContactCommand,
  updateContactPointCommand,
} from '@/lib/application/rich-contact-commands';
import { getRepository } from '@/lib/data';
import {
  contactListHref,
  contactRecordHref,
  parseSerializedBrowseContext,
  resolveArchiveContinuation,
  type ContactBrowseContext,
} from '@/lib/application/contact-navigation';
import type { RichContactRepository } from '@/lib/data/rich-contact-repository';
import { RichContactError, type CustomFieldValue } from '@/lib/domain/rich-contact';
import type { RichContactActionState } from '@/app/contacts/action-state';

async function context() {
  const repositoryContext = await getRepository();
  if (!('richContactRepository' in repositoryContext) || !repositoryContext.richContactRepository) {
    throw new RichContactError('conflict', 'Rich contact records are unavailable in this workspace.');
  }
  return {
    repository: repositoryContext.richContactRepository as RichContactRepository,
    scope: repositoryContext.workspaceScope,
  };
}

function result(error: unknown): RichContactActionState {
  if (error instanceof RichContactError) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors };
  }
  console.error('[rich-contact-action]', error);
  return { status: 'error', message: "We couldn't save that change. Nothing was updated." };
}

function refresh(contactId?: string) {
  revalidatePath('/contacts');
  revalidatePath('/workspace');
  revalidatePath('/activities');
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

async function run(
  operation: () => Promise<unknown>,
  message: string,
  contactId?: string,
): Promise<RichContactActionState> {
  try {
    await operation();
    refresh(contactId);
    return { status: 'success', message };
  } catch (error) {
    return result(error);
  }
}

export async function saveContactPointAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  return run(async () => {
    const { repository, scope } = await context();
    const input = {
      type: formData.get('type'),
      label: formData.get('label'),
      displayValue: formData.get('displayValue'),
      isPrimary: formData.get('isPrimary') === 'on',
      emailSubscribed: formData.get('emailSubscribed') !== 'false',
      displayOrder: formData.get('displayOrder'),
    };
    const pointId = String(formData.get('pointId') ?? '');
    if (pointId) await updateContactPointCommand(repository, scope, { pointId, ...input });
    else await addContactPointCommand(repository, scope, { contactId, ...input });
  }, formData.get('pointId') ? 'Contact point updated.' : 'Contact point added.', contactId);
}

export async function setContactPointStatusAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const restore = formData.get('intent') === 'restore';
  return run(async () => {
    const { repository, scope } = await context();
    if (restore) await restoreContactPointCommand(repository, scope, formData.get('pointId'));
    else await archiveContactPointCommand(repository, scope, formData.get('pointId'), formData.get('reason'));
  }, restore ? 'Contact point restored.' : 'Contact point archived.', contactId);
}

export async function createHouseholdAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '') || undefined;
  return run(async () => {
    const { repository, scope } = await context();
    await createHouseholdCommand(repository, scope, formData.get('name'));
  }, 'Household created.', contactId);
}

export async function setHouseholdMembershipAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const remove = formData.get('intent') === 'remove';
  return run(async () => {
    const { repository, scope } = await context();
    if (remove) await removeHouseholdMemberCommand(repository, scope, formData.get('householdId'), contactId);
    else await addHouseholdMemberCommand(repository, scope, formData.get('householdId'), contactId);
  }, remove ? 'Removed from household.' : 'Added to household.', contactId);
}

export async function archiveHouseholdAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '') || undefined;
  return run(async () => {
    const { repository, scope } = await context();
    await archiveHouseholdCommand(repository, scope, formData.get('householdId'));
  }, 'Household archived.', contactId);
}

export async function addRelationshipAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  return run(async () => {
    const { repository, scope } = await context();
    await addPersonRelationshipCommand(repository, scope, {
      firstContactId: contactId,
      secondContactId: formData.get('secondContactId'),
      kind: formData.get('kind'),
      label: formData.get('label'),
    });
  }, 'Relationship added.', contactId);
}

export async function setRelationshipStatusAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const restore = formData.get('intent') === 'restore';
  return run(async () => {
    const { repository, scope } = await context();
    if (restore) await restorePersonRelationshipCommand(repository, scope, formData.get('relationshipId'));
    else await archivePersonRelationshipCommand(repository, scope, formData.get('relationshipId'));
  }, restore ? 'Relationship restored.' : 'Relationship archived.', contactId);
}

export async function setAssignmentAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const remove = formData.get('intent') === 'remove';
  return run(async () => {
    const { repository, scope } = await context();
    if (remove) await unassignContactCommand(repository, scope, formData.get('assignmentId'));
    else await assignContactCommand(repository, scope, contactId, formData.get('assigneeMembershipId'));
  }, remove ? 'Assignment removed.' : 'Contact assigned.', contactId);
}

export async function createCustomFieldAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '') || undefined;
  return run(async () => {
    const { repository, scope } = await context();
    const options = String(formData.get('options') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    await createCustomFieldDefinitionCommand(repository, scope, {
      name: formData.get('name'),
      type: formData.get('type'),
      options,
      displayOrder: formData.get('displayOrder'),
    });
  }, 'Custom field created.', contactId);
}

export async function archiveCustomFieldAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '') || undefined;
  return run(async () => {
    const { repository, scope } = await context();
    await archiveCustomFieldDefinitionCommand(repository, scope, formData.get('definitionId'));
  }, 'Custom field archived.', contactId);
}

export async function setCustomFieldValueAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  return run(async () => {
    const { repository, scope } = await context();
    const definitionId = String(formData.get('definitionId') ?? '');
    const definitions = await listCustomFieldDefinitionsCommand(repository, scope, true);
    const definition = definitions.find((item) => item.id === definitionId);
    if (!definition) throw new RichContactError('not-found', 'Custom field definition was not found.');
    const raw = formData.get('value');
    let value: CustomFieldValue;
    if (definition.type === 'boolean') value = raw === 'true';
    else if (definition.type === 'number') value = Number(raw);
    else value = String(raw ?? '');
    await setContactCustomFieldValueCommand(repository, scope, { contactId, definitionId, value });
  }, 'Custom value saved.', contactId);
}

function withSaved(href: string, saved: string): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('saved', saved);
  return `${path}?${params.toString()}`;
}

/**
 * Where work continues after a confirmed archive. Every input from the browser
 * is re-validated here: the list context is parsed against known filters, the
 * Smart List is read through the workspace-scoped repository, and the successor
 * is chosen from the server's own sequence. Only internal /contacts paths are
 * ever produced, so no client value can redirect elsewhere.
 */
function withArchived(href: string, saved: string, contactId: string): string {
  const [path, query = ''] = withSaved(href, saved).split('?');
  const params = new URLSearchParams(query);
  params.set('archivedContact', contactId);
  return `${path}?${params.toString()}`;
}

async function archiveDestination(contactId: string, listContext: ContactBrowseContext | undefined): Promise<string> {
  if (!listContext) return withArchived('/contacts', 'archived', contactId);
  try {
    const { repository, smartListRepository, workspaceScope } = await getRepository();
    let definition;
    if (listContext.smartList) {
      const smartList = await smartListRepository.get(workspaceScope, listContext.smartList);
      if (smartList?.status !== 'active') return withArchived(contactListHref(listContext), 'archived', contactId);
      definition = smartList.definition;
    }
    const contacts = await repository.list({ includeArchived: true });
    const continuation = resolveArchiveContinuation(contacts, contactId, listContext, definition);
    if (continuation.kind === 'list') return withArchived(contactListHref(continuation.context), 'archived-end', contactId);
    const params = new URLSearchParams({ archivedContact: contactId });
    return `${contactRecordHref(continuation.contactId, continuation.context, 'archived-next')}&${params.toString()}`;
  } catch (error) {
    // The archive itself is already committed; only the continuation failed.
    console.error('[rich-contact-action:archive-continuation]', error);
    return withArchived(contactListHref(listContext), 'archived', contactId);
  }
}

export async function archiveContactLifecycleAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const reason = typeof formData.get('reason') === 'string' ? String(formData.get('reason')) : '';
  let listContext: ContactBrowseContext | undefined;
  const state = await run(async () => {
    const { repository, scope } = await context();
    const { repository: contactRepository } = await getRepository();
    const current = await contactRepository.get(contactId);
    if (!current) throw new RichContactError('not-found', 'Contact was not found.');
    listContext = parseSerializedBrowseContext(formData.get('returnContext'), current);
    await archiveContactCommand(repository, scope, contactId, formData.get('reason'));
  }, 'Contact archived.', contactId);
  if (state.status !== 'success') return { ...state, values: { reason } };
  redirect(await archiveDestination(contactId, listContext));
}

export async function restoreContactLifecycleAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const state = await run(async () => {
    const { repository, scope } = await context();
    await restoreContactCommand(repository, scope, contactId);
  }, 'Contact restored.', contactId);
  if (state.status === 'success') redirect(`/contacts/${encodeURIComponent(contactId)}?saved=restored`);
  return state;
}

/**
 * "Undo" right after an archive: restores the contact and returns to it inside
 * the same list the realtor was working through. Only a contact that is
 * currently archived can be restored, and only internal /contacts paths result.
 */
export async function undoArchiveContactAction(formData: FormData): Promise<void> {
  const contactId = String(formData.get('contactId') ?? '');
  let destination = '/contacts';
  try {
    const { repository: contactRepository } = await getRepository();
    const current = await contactRepository.get(contactId);
    if (!current?.archivedAt) {
      destination = current ? `/contacts/${encodeURIComponent(contactId)}` : '/contacts';
    } else {
      const { repository, scope } = await context();
      await restoreContactCommand(repository, scope, contactId);
      refresh(contactId);
      const { archivedAt: _archivedAt, ...active } = current;
      void _archivedAt;
      const listContext = parseSerializedBrowseContext(formData.get('returnContext'), active);
      destination = listContext ? contactRecordHref(contactId, listContext, 'restored') : `/contacts/${encodeURIComponent(contactId)}?saved=restored`;
    }
  } catch (error) {
    console.error('[rich-contact-action:undo-archive]', error);
    destination = `/contacts?saved=undo-failed`;
  }
  redirect(destination);
}
