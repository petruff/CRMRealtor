import { describe, expect, it } from 'vitest';
import { hashPortalToken, memoryClientPortalRepository, newPortalToken } from './client-portal-repository.ts';
import type { RealEstateTransaction } from '../domain/transaction.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { isPortalToken } from '../domain/client-portal.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'u', ownerUserId: 'u', membershipId: '00000000-0000-4000-8000-000000000005',
  workspaceId: '00000000-0000-4000-8000-000000000002', role: 'owner', mode: 'live',
};
const deal = {
  id: '00000000-0000-4000-8000-000000000003', workspaceId: scope.workspaceId, status: 'under-contract', side: 'buyer',
  propertyAddress: '1408 Bayshore Dr', expectedCloseDate: '2026-10-16', grossCommissionCents: 1455000, title: 'Internal',
} as unknown as RealEstateTransaction;

function repository(status = 'under-contract') {
  return memoryClientPortalRepository({
    scope, agentName: 'Paula',
    transactions: async () => [{ ...deal, status } as RealEstateTransaction],
    milestones: async () => [],
  });
}

describe('client portal links', () => {
  it('issues unguessable tokens and stores only their hash', () => {
    const token = newPortalToken();
    expect(isPortalToken(token)).toBe(true);
    expect(hashPortalToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(newPortalToken()).not.toBe(token);
  });

  it('opens an active link, counts views and never exposes internal fields', async () => {
    const repo = repository();
    const { token, link } = await repo.create(scope, { transactionId: deal.id, audienceLabel: 'Linh', expiresAt: '2026-11-22T00:00:00.000Z' });
    const opened = await repo.open(token, new Date('2026-09-23T15:00:00.000Z'));
    expect(opened).toMatchObject({ audience: 'Linh', agentName: 'Paula', propertyAddress: '1408 Bayshore Dr', status: 'under-contract' });
    expect(opened).not.toHaveProperty('grossCommissionCents');
    expect(JSON.stringify(await repo.listForTransactions(scope, [deal.id]))).not.toContain(token);
    expect((await repo.listForTransactions(scope, [deal.id]))[0]).toMatchObject({ id: link.id, viewCount: 1 });
  });

  it('refuses revoked, expired, unknown and lost-deal links', async () => {
    const repo = repository();
    const { token, link } = await repo.create(scope, { transactionId: deal.id, audienceLabel: 'Linh', expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(await repo.open(token, new Date('2026-10-02T00:00:00.000Z'))).toBeUndefined();
    expect(await repo.open(newPortalToken())).toBeUndefined();
    await repo.revoke(scope, link.id, '2026-09-23T00:00:00.000Z');
    expect(await repo.open(token, new Date('2026-09-23T15:00:00.000Z'))).toBeUndefined();

    const lost = repository('lost');
    const created = await lost.create(scope, { transactionId: deal.id, audienceLabel: 'Linh', expiresAt: '2026-11-22T00:00:00.000Z' });
    expect(await lost.open(created.token, new Date('2026-09-23T15:00:00.000Z'))).toBeUndefined();
  });

  it('keeps links inside their workspace', async () => {
    const repo = repository();
    await repo.create(scope, { transactionId: deal.id, audienceLabel: 'Linh', expiresAt: '2026-11-22T00:00:00.000Z' });
    expect(await repo.listForTransactions({ ...scope, workspaceId: 'other' }, [deal.id])).toEqual([]);
  });
});
