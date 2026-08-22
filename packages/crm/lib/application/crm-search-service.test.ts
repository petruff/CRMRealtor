import { describe, expect, it } from 'vitest';
import { searchCrm } from './crm-search-service.ts';
import { memoryRepository } from '../data/memory-repository.ts';
import { createMemoryActivityRepository } from '../data/memory-activity-repository.ts';
import { createMemoryIncompleteRecordRepository } from '../data/memory-incomplete-record-repository.ts';
import { createMemorySmartListRepository } from '../data/memory-smart-list-repository.ts';
import { memoryMailerRepository } from '../data/memory-mailer-repository.ts';
import { createSampleWorkspaceRepository } from '../data/memory-workspace-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';

describe('searchCrm', () => {
  it('ranks exact contact IDs first and returns typed deep links deterministically', async () => {
    const repository = memoryRepository();
    const response = await searchCrm({
      repository,
      activityRepository: createMemoryActivityRepository(),
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      smartListRepository: createMemorySmartListRepository(),
      mailerRepository: memoryMailerRepository(repository),
      workspaceRepository: createSampleWorkspaceRepository(true),
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    }, 'c-monroe');
    expect(response.results[0]).toMatchObject({ entityType: 'contact', recordId: 'c-monroe', href: '/contacts/c-monroe', rank: 100 });
    expect(response.schemaVersion).toBe('crm-search.v1');
  });

  it('rejects empty and oversized queries', async () => {
    const repository = memoryRepository();
    const context = {
      repository, activityRepository: createMemoryActivityRepository(),
      incompleteRecordRepository: createMemoryIncompleteRecordRepository(),
      smartListRepository: createMemorySmartListRepository(), mailerRepository: memoryMailerRepository(repository),
      workspaceRepository: createSampleWorkspaceRepository(), workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    };
    await expect(searchCrm(context, '')).rejects.toThrow('1–120');
    await expect(searchCrm(context, 'x'.repeat(121))).rejects.toThrow('1–120');
  });
});
