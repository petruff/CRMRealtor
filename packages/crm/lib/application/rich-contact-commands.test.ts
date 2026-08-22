import { describe, expect, it } from 'vitest';
import type { Contact } from '../domain/contact';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import { createMemoryRichContactRepository } from '../data/memory-rich-contact-repository';
import type { ContactRepository } from '../data/repository';
import {
  addContactPointCommand,
  addHouseholdMemberCommand,
  addPersonRelationshipCommand,
  archiveContactCommand,
  assignContactCommand,
  createCustomFieldDefinitionCommand,
  createHouseholdCommand,
  listHouseholdMembersCommand,
  removeHouseholdMemberCommand,
  restoreContactCommand,
  setContactCustomFieldValueCommand,
} from './rich-contact-commands';

const NOW = new Date('2026-08-11T00:00:00.000Z');

function contact(id: string): Contact {
  return {
    id, firstName: id, lastName: 'Example', leadType: 'warm', relationship: 'lead',
    intent: 'unknown', source: 'other', pipelineStage: 'new', tags: [],
    createdAt: '2026-08-11T00:00:00.000Z', emailSubscribed: true,
  };
}

function harness() {
  const contacts = new Map([['contact-a', contact('contact-a')], ['contact-b', contact('contact-b')]]);
  const contactRepository: ContactRepository = {
    list: async () => [...contacts.values()],
    get: async (id) => contacts.get(id),
    create: async (input) => {
      const created = { ...input, id: 'contact-created', createdAt: '2026-08-11T00:00:00.000Z' };
      contacts.set(created.id, created);
      return created;
    },
    update: async (id, patch) => {
      const existing = contacts.get(id);
      if (!existing) throw new Error('missing');
      const updated = { ...existing, ...patch, id };
      contacts.set(id, updated);
      return updated;
    },
    remove: async (id) => { contacts.delete(id); },
    notesFor: async () => [],
    addNote: async (contactId, body) => ({ id: 'note-a', contactId, body, createdAt: '2026-08-11T00:00:00.000Z' }),
  };
  return {
    contacts,
    repository: createMemoryRichContactRepository({
      contactRepository,
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId, 'membership-assistant'],
    }),
  };
}

describe('rich contact commands', () => {
  it('enforces per-contact point bounds, duplicate normalization and primary conflicts', async () => {
    const { repository } = harness();
    await addContactPointCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      contactId: 'contact-a', type: 'phone', label: 'Mobile', displayValue: '(614) 555-0100', isPrimary: true,
    });
    await expect(addContactPointCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      contactId: 'contact-a', type: 'phone', label: 'Duplicate', displayValue: '+1 614 555 0100',
    })).rejects.toMatchObject({ code: 'conflict' });
    await expect(addContactPointCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      contactId: 'contact-a', type: 'phone', label: 'Office', displayValue: '614-555-0101', isPrimary: true,
    })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rejects reverse relationship duplicates and revoked assignees', async () => {
    const { repository } = harness();
    await addPersonRelationshipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      firstContactId: 'contact-b', secondContactId: 'contact-a', kind: 'partner',
    });
    await expect(addPersonRelationshipCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      firstContactId: 'contact-a', secondContactId: 'contact-b', kind: 'spouse',
    })).rejects.toMatchObject({ code: 'conflict' });
    await expect(assignContactCommand(
      repository, SAMPLE_WORKSPACE_SCOPE, 'contact-a', 'revoked-membership',
    )).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps custom field definitions owner-only and validates values', async () => {
    const { repository } = harness();
    const assistant = { ...SAMPLE_WORKSPACE_SCOPE, role: 'assistant' as const, membershipId: 'membership-assistant' };
    await expect(createCustomFieldDefinitionCommand(repository, assistant, {
      name: 'Closing gift', type: 'single-select', options: ['Wine', 'Flowers'],
    })).rejects.toMatchObject({ code: 'forbidden' });
    const definition = await createCustomFieldDefinitionCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      name: 'Closing gift', type: 'single-select', options: ['Wine', 'Flowers'],
    });
    await expect(setContactCustomFieldValueCommand(repository, assistant, {
      contactId: 'contact-a', definitionId: definition.id, value: 'Unknown',
    })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(setContactCustomFieldValueCommand(repository, assistant, {
      contactId: 'contact-a', definitionId: definition.id, value: 'Wine',
    })).resolves.toMatchObject({ value: 'Wine' });
  });

  it('archives and restores the same contact identity without deletion', async () => {
    const { repository, contacts } = harness();
    await archiveContactCommand(repository, SAMPLE_WORKSPACE_SCOPE, 'contact-a', 'Duplicate review');
    expect(contacts.get('contact-a')).toMatchObject({ archiveReason: 'Duplicate review' });
    await restoreContactCommand(repository, SAMPLE_WORKSPACE_SCOPE, 'contact-a');
    expect(contacts.get('contact-a')?.archivedAt).toBeUndefined();
    expect(contacts.has('contact-a')).toBe(true);
  });

  it('ends household membership without deleting its history and permits a later rejoin', async () => {
    const { repository } = harness();
    const household = await createHouseholdCommand(repository, SAMPLE_WORKSPACE_SCOPE, 'Rivera household', NOW);
    const first = await addHouseholdMemberCommand(
      repository, SAMPLE_WORKSPACE_SCOPE, household.id, 'contact-a', NOW,
    );
    await removeHouseholdMemberCommand(
      repository, SAMPLE_WORKSPACE_SCOPE, household.id, 'contact-a', new Date('2026-08-11T01:00:00.000Z'),
    );
    expect(await listHouseholdMembersCommand(repository, SAMPLE_WORKSPACE_SCOPE, household.id)).toEqual([]);
    const second = await addHouseholdMemberCommand(
      repository, SAMPLE_WORKSPACE_SCOPE, household.id, 'contact-a', new Date('2026-08-11T02:00:00.000Z'),
    );
    expect(second.id).not.toBe(first.id);
  });
});
