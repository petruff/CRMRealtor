import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addContactPointCommand,
  listCustomFieldDefinitionsCommand,
  setContactCustomFieldValueCommand,
} from '@/lib/application/rich-contact-commands';
import { getRepository } from '@/lib/data';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { INITIAL_RICH_CONTACT_ACTION_STATE } from './action-state';
import {
  saveContactPointAction,
  setCustomFieldValueAction,
} from './rich-actions';

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
