import { describe, expect, it } from 'vitest';
import { memoryRepository } from './memory-repository';

describe('memoryRepository canonical page parity', () => {
  it('preserves server-page search, filters, counts, ordering, and Smart List semantics', async () => {
    const repository = memoryRepository();
    const marker = 'CanonicalPageParity';
    const hotLead = await repository.create({
      firstName: marker,
      lastName: 'Hot',
      leadType: 'hot',
      relationship: 'lead',
      intent: 'buyer',
      source: 'referral',
      pipelineStage: 'new',
      tags: ['Audit'],
    });
    await repository.create({
      firstName: marker,
      lastName: 'Client',
      leadType: 'warm',
      relationship: 'active-client',
      intent: 'seller',
      source: 'website',
      pipelineStage: 'active',
      tags: [],
    });

    await expect(repository.listPage?.({
      scope: 'leads', query: marker, leadType: 'hot', source: 'referral', offset: 0, limit: 50,
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: hotLead.id })],
      total: 1,
      scopeCounts: { leads: 1, clients: 0, all: 1 },
      leadTypeCounts: { hot: 1, warm: 0, nurture: 0 },
      aliasEpoch: 0,
    });

    await expect(repository.listPage?.({
      scope: 'all', query: marker, offset: 0, limit: 50,
      smartListId: 'memory-smart-list',
      smartListDefinition: {
        schemaVersion: 'smart-list-filter.v1',
        criteria: [{ field: 'source', operator: 'eq', value: 'referral' }],
      },
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: hotLead.id })],
      total: 1,
    });
  });
});
