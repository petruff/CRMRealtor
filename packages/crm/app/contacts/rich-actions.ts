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

export async function archiveContactLifecycleAction(
  _state: RichContactActionState,
  formData: FormData,
): Promise<RichContactActionState> {
  const contactId = String(formData.get('contactId') ?? '');
  const state = await run(async () => {
    const { repository, scope } = await context();
    await archiveContactCommand(repository, scope, contactId, formData.get('reason'));
  }, 'Contact archived.', contactId);
  if (state.status === 'success') redirect(`/contacts/${encodeURIComponent(contactId)}?view=archived&saved=archived`);
  return state;
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
