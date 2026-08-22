import { describe, expect, it } from 'vitest';
import { moveContactPipelineStageCommand } from './pipeline-commands.ts';
import { createMemoryPipelineRepository } from '../data/memory-pipeline-repository.ts';
import { createMemoryActivityRepository } from '../data/memory-activity-repository.ts';
import type { ContactRepository } from '../data/repository.ts';
import type { Contact } from '../domain/contact.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';

function context() {
  let contact: Contact = { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', leadType: 'hot', relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'new', tags: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' };
  const contacts: ContactRepository = {
    async list() { return [contact]; }, async get(id) { return id === contact.id ? contact : undefined; },
    async create() { throw new Error('not used'); }, async update(id, patch) { contact = { ...contact, ...patch, id }; return contact; },
    async remove() {}, async notesFor() { return []; }, async addNote() { throw new Error('not used'); },
    async runTransaction(operation) { const before = contact; try { return await operation(); } catch (error) { contact = before; throw error; } },
  };
  const activities = createMemoryActivityRepository({ activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId], isActiveContact: () => true });
  return { contacts, activities, pipeline: createMemoryPipelineRepository({ contacts, activities }), getContact: () => contact };
}

describe('moveContactPipelineStageCommand', () => {
  it('persists stage and one metadata event', async () => {
    const value = context();
    const receipt = await moveContactPipelineStageCommand(value.pipeline, SAMPLE_WORKSPACE_SCOPE, { contactId: 'contact-1', fromStage: 'new', toStage: 'active', expectedUpdatedAt: '2026-08-01T00:00:00.000Z', idempotencyKey: 'move-1' }, new Date('2026-08-12T10:00:00.000Z'));
    expect(receipt.contact.pipelineStage).toBe('active');
    expect(receipt.event?.metadata).toEqual({ fromStage: 'new', toStage: 'active' });
    expect((await value.activities.listEvents(SAMPLE_WORKSPACE_SCOPE, { limit: 10 })).length).toBe(1);
  });
  it('fails stale moves without changing the contact', async () => {
    const value = context();
    await expect(moveContactPipelineStageCommand(value.pipeline, SAMPLE_WORKSPACE_SCOPE, { contactId: 'contact-1', fromStage: 'new', toStage: 'active', expectedUpdatedAt: '2025-01-01T00:00:00.000Z', idempotencyKey: 'move-stale' })).rejects.toMatchObject({ code: 'conflict' });
    expect(value.getContact().pipelineStage).toBe('new');
  });
});
