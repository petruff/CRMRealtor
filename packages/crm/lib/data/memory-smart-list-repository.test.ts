import { describe, expect, it } from 'vitest';
import { createSmartListCommand } from '@/lib/application/smart-list-commands';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { createMemorySmartListRepository } from './memory-smart-list-repository';

describe('memory Smart List repository', () => {
  it('uses reset-safe deterministic IDs per factory', async () => {
    const create = (repository: ReturnType<typeof createMemorySmartListRepository>) => createSmartListCommand(
      repository, SAMPLE_WORKSPACE_SCOPE,
      { name: 'List', definition: { schemaVersion: 'smart-list-filter.v1', criteria: [] } },
      new Date('2026-08-11T00:00:00Z'),
    );
    expect((await create(createMemorySmartListRepository())).id).toBe('smart-list-0001');
    expect((await create(createMemorySmartListRepository())).id).toBe('smart-list-0001');
  });
});
