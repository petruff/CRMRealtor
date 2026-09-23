import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import {
  addContactPointCommand,
  archiveContactCommand,
  listCustomFieldDefinitionsCommand,
  setContactCustomFieldValueCommand,
} from '@/lib/application/rich-contact-commands';
import { getRepository } from '@/lib/data';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { INITIAL_RICH_CONTACT_ACTION_STATE } from './action-state';
import {
  archiveContactLifecycleAction,
  saveContactPointAction,
  setCustomFieldValueAction,
} from './rich-actions';
import type { Contact } from '@/lib/domain/contact';
import { RichContactError } from '@/lib/domain/rich-contact';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/application/rich-contact-commands', () => ({
  addContactPointCommand: vi.fn(),
  updateContactPointCommand: vi.fn(),
  archiveContactPointCommand: vi.fn(),
  restoreContactPointCommand: vi.fn(),
  createHouseholdCommand: vi.fn(),
  addHouseholdMemberCommand: vi.fn(),
  removeHouseholdMemberCommand: vi.fn(),
  archiveHouseholdCommand: vi.fn(),
  addPersonRelationshipCommand: vi.fn(),
  archivePersonRelationshipCommand: vi.fn(),
  restorePersonRelationshipCommand: vi.fn(),
  assignContactCommand: vi.fn(),
  unassignContactCommand: vi.fn(),
  createCustomFieldDefinitionCommand: vi.fn(),
  archiveCustomFieldDefinitionCommand: vi.fn(),
  listCustomFieldDefinitionsCommand: vi.fn(),
  setContactCustomFieldValueCommand: vi.fn(),
  archiveContactCommand: vi.fn(),
  restoreContactCommand: vi.fn(),
}));

describe('rich contact server actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRepository).mockResolvedValue({
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      richContactRepository: {},
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  it('maps a contact-point form through the application command seam', async () => {
    const form = new FormData();
    form.set('contactId', 'c-1');
    form.set('type', 'email');
    form.set('label', 'Personal');
    form.set('displayValue', 'Alicia@Example.com');
    form.set('isPrimary', 'on');
    form.set('emailSubscribed', 'false');
    form.set('displayOrder', '0');

    const state = await saveContactPointAction(INITIAL_RICH_CONTACT_ACTION_STATE, form);

    expect(state.status).toBe('success');
    expect(addContactPointCommand).toHaveBeenCalledWith(
      expect.anything(),
      SAMPLE_WORKSPACE_SCOPE,
      expect.objectContaining({
        contactId: 'c-1',
        type: 'email',
        isPrimary: true,
        emailSubscribed: false,
      }),
    );
  });

  it('converts numeric custom input before validation and persistence', async () => {
    vi.mocked(listCustomFieldDefinitionsCommand).mockResolvedValue([{
      id: 'definition-1',
      workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
      name: 'Equity estimate',
      type: 'number',
      options: [],
      displayOrder: 0,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    }]);
    const form = new FormData();
    form.set('contactId', 'c-1');
    form.set('definitionId', 'definition-1');
    form.set('value', '425000');

    const state = await setCustomFieldValueAction(INITIAL_RICH_CONTACT_ACTION_STATE, form);

    expect(state.status).toBe('success');
    expect(setContactCustomFieldValueCommand).toHaveBeenCalledWith(
      expect.anything(),
      SAMPLE_WORKSPACE_SCOPE,
      { contactId: 'c-1', definitionId: 'definition-1', value: 425000 },
    );
  });
});

describe('archive contact lifecycle continuation', () => {
  const archivedAt = '2026-09-23T15:00:00.000Z';
  const person = (id: string, patch: Partial<Contact> = {}): Contact => ({
    id, firstName: id.toUpperCase(), lastName: 'Lead', leadType: 'warm', relationship: 'lead',
    intent: 'unknown', source: 'other', pipelineStage: 'new', tags: [], createdAt: '2026-09-01T12:00:00.000Z', ...patch,
  });
  let contacts: Contact[];
  const smartListGet = vi.fn();
  const list = vi.fn();

  function archiveForm(returnContext?: string) {
    const form = new FormData();
    form.set('contactId', 'b');
    form.set('reason', 'No longer actively managed');
    if (returnContext !== undefined) form.set('returnContext', returnContext);
    return form;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    contacts = ['a', 'b', 'c', 'd'].map((id) => person(id));
    list.mockImplementation(async () => contacts);
    vi.mocked(getRepository).mockResolvedValue({
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      richContactRepository: {},
      repository: {
        get: async (id: string) => contacts.find((contact) => contact.id === id),
        list,
      },
      smartListRepository: { get: smartListGet },
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
    vi.mocked(archiveContactCommand).mockImplementation(async (_repository, _scope, id) => {
      contacts = contacts.map((contact) => (contact.id === id ? { ...contact, archivedAt } : contact));
      return undefined as never;
    });
  });

  it('archives and opens the next contact of the same list instead of the archived view', async () => {
    await archiveContactLifecycleAction(INITIAL_RICH_CONTACT_ACTION_STATE, archiveForm('q=lead&from=list'));

    expect(archiveContactCommand).toHaveBeenCalledWith(expect.anything(), SAMPLE_WORKSPACE_SCOPE, 'b', 'No longer actively managed');
    expect(redirect).toHaveBeenCalledWith('/contacts/c?q=lead&from=list&saved=archived-next&archivedContact=b');
    expect(vi.mocked(redirect).mock.calls[0]?.[0]).not.toContain('view=archived');
  });

  it('returns to the filtered list when the archived contact was the last one', async () => {
    const form = archiveForm('from=list');
    form.set('contactId', 'd');

    await archiveContactLifecycleAction(INITIAL_RICH_CONTACT_ACTION_STATE, form);

    expect(redirect).toHaveBeenCalledWith('/contacts?saved=archived-end');
  });

  it('uses /contacts as the safe return for direct access without list context', async () => {
    await archiveContactLifecycleAction(INITIAL_RICH_CONTACT_ACTION_STATE, archiveForm());
    expect(redirect).toHaveBeenCalledWith('/contacts?saved=archived');
    expect(list).not.toHaveBeenCalled();
  });

  it('ignores external URLs and resolves smart lists only inside the workspace', async () => {
    smartListGet.mockResolvedValue(undefined);

    await archiveContactLifecycleAction(
      INITIAL_RICH_CONTACT_ACTION_STATE,
      archiveForm('from=list&smartList=other-workspace-list&returnTo=https://evil.example'),
    );

    expect(smartListGet).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, 'other-workspace-list');
    expect(redirect).toHaveBeenCalledWith('/contacts?smartList=other-workspace-list&saved=archived');
    expect(String(vi.mocked(redirect).mock.calls[0]?.[0])).not.toContain('evil');
  });

  it('does not advance and keeps the reason when the archive is rejected', async () => {
    vi.mocked(archiveContactCommand).mockRejectedValue(new RichContactError('conflict', 'Contact changed. Refresh and try again.'));

    const state = await archiveContactLifecycleAction(INITIAL_RICH_CONTACT_ACTION_STATE, archiveForm('from=list'));

    expect(state).toMatchObject({ status: 'error', message: 'Contact changed. Refresh and try again.', values: { reason: 'No longer actively managed' } });
    expect(redirect).not.toHaveBeenCalled();
    expect(contacts.find((contact) => contact.id === 'b')?.archivedAt).toBeUndefined();
  });

  it('confirms the archive with a safe list return when only the continuation lookup fails', async () => {
    list.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await archiveContactLifecycleAction(INITIAL_RICH_CONTACT_ACTION_STATE, archiveForm('scope=leads&q=lead&from=list'));

    expect(redirect).toHaveBeenCalledWith('/contacts?q=lead&saved=archived');
  });
});
