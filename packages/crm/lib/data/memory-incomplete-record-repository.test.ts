import { describe, expect, it } from 'vitest';
import { createIncompleteRecordCommand } from '@/lib/application/incomplete-record-commands';
import { SAMPLE_WORKSPACE_SCOPE, type WorkspaceScope } from '@/lib/domain/workspace';
import { createMemoryIncompleteRecordRepository } from './memory-incomplete-record-repository';

describe('memory incomplete record repository', () => {
  it('fails closed for cross-workspace reads and conversions', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const created = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'website', candidate: { firstName: 'Ana' }, reasons: ['Invalid row.'],
    });
    const other: WorkspaceScope = {
      ...SAMPLE_WORKSPACE_SCOPE, workspaceId: 'workspace-other', membershipId: 'membership-other',
      authenticatedUserId: 'user-other',
    };
    expect(await repository.get(other, created.id)).toBeUndefined();
    await expect(repository.previewConversion(other, { recordId: created.id, candidate: created.candidate }))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('finds a quarantined record by its record id', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const created = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'meta-live', candidate: { firstName: 'Ana' }, reasons: ['Review.'],
    });
    const records = await repository.list(SAMPLE_WORKSPACE_SCOPE, {
      status: 'pending', query: created.id, limit: 20,
    });
    expect(records.map((record) => record.id)).toEqual([created.id]);
  });
});
