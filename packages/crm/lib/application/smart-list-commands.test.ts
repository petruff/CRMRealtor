import { describe, expect, it } from 'vitest';
import { createMemorySmartListRepository } from '@/lib/data/memory-smart-list-repository';
import type { SmartListContactSource } from '@/lib/data/smart-list-repository';
import type { Contact } from '@/lib/domain/contact';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';
import {
  applySmartListCommand,
  archiveSmartListCommand,
  createSmartListCommand,
  listSmartListsCommand,
  restoreSmartListCommand,
  updateSmartListCommand,
} from './smart-list-commands';

const now = new Date('2026-08-11T12:00:00.000Z');
const definition = { schemaVersion: 'smart-list-filter.v1', criteria: [] } as const;

function contact(id: string, leadType: Contact['leadType']): Contact {
  return {
    id, firstName: id, lastName: 'Agent', leadType, relationship: 'lead', intent: 'buyer',
    source: 'referral', pipelineStage: 'new', tags: [], createdAt: now.toISOString(),
  };
}

describe('Smart List commands', () => {
  it('creates, updates, lists and applies through required workspace-scoped seams', async () => {
    const repository = createMemorySmartListRepository();
    const contacts: SmartListContactSource = {
      async list(scope) {
        expect(scope).toEqual(SAMPLE_WORKSPACE_SCOPE);
        return [contact('warm', 'warm'), contact('hot', 'hot')];
      },
    };
    const created = await createSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      name: ' Priority ', definition,
    }, now);
    expect(created).toMatchObject({ id: 'smart-list-0001', workspaceId: 'workspace-sample', name: 'Priority' });
    await updateSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, created.id, { name: 'Today' }, now);
    expect(await listSmartListsCommand(repository, SAMPLE_WORKSPACE_SCOPE)).toHaveLength(1);
    expect((await applySmartListCommand(repository, contacts, SAMPLE_WORKSPACE_SCOPE, created.id)).contactIds)
      .toEqual(['hot', 'warm']);
  });

  it('does not apply archived lists and makes archive/restore replay explicit', async () => {
    const repository = createMemorySmartListRepository();
    const created = await createSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      name: 'Priority', definition,
    }, now);
    expect((await archiveSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, created.id, 'old', now)).noOp)
      .toBe(false);
    expect((await archiveSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, created.id, 'old', now)).noOp)
      .toBe(true);
    await expect(applySmartListCommand(repository, { list: async () => [] }, SAMPLE_WORKSPACE_SCOPE, created.id))
      .rejects.toThrow(/restored/i);
    expect((await restoreSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, created.id, now)).noOp).toBe(false);
  });

  it('returns every contact ID when a caller requests exhaustive evaluation beyond 500', async () => {
    const repository = createMemorySmartListRepository();
    const created = await createSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      name: 'Complete audience', definition,
    }, now);
    const source = Array.from({ length: 501 }, (_, index) => contact(`contact-${index}`, 'warm'));

    const applied = await applySmartListCommand(
      repository,
      { list: async () => source },
      SAMPLE_WORKSPACE_SCOPE,
      created.id,
    );

    expect(applied.contactIds).toHaveLength(501);
    expect(applied.contactIds).toContain('contact-500');
    expect(applied).not.toHaveProperty('resultLimit');
  });

  it('keeps records isolated by workspace scope', async () => {
    const repository = createMemorySmartListRepository();
    const created = await createSmartListCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      name: 'Priority', definition,
    }, now);
    const other: WorkspaceScope = {
      ...SAMPLE_WORKSPACE_SCOPE,
      workspaceId: 'workspace-other', membershipId: 'membership-other', authenticatedUserId: 'user-other',
    };
    expect(await repository.get(other, created.id)).toBeUndefined();
    expect(await repository.list(other)).toEqual([]);
  });
});
