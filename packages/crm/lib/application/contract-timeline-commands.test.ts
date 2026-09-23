import { describe, expect, it, vi } from 'vitest';
import type { ContactRepository } from '../data/repository.ts';
import type { TransactionRepository } from '../data/transaction-repository.ts';
import { createMemoryOperationalSignalRepository } from '../data/memory-operational-signal-repository.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import { createContractTimelineCommand } from './contract-timeline-commands.ts';

const scope: WorkspaceScope = {
  authenticatedUserId: 'u', ownerUserId: 'u', membershipId: '00000000-0000-4000-8000-000000000005',
  workspaceId: '00000000-0000-4000-8000-000000000002', role: 'owner', mode: 'live',
};
const transaction = { id: '00000000-0000-4000-8000-000000000003', workspaceId: scope.workspaceId, contactId: '00000000-0000-4000-8000-000000000004', contactName: 'Ana', propertyAddress: '1408 Bayshore Dr', grossCommissionCents: 0 };
const timeline = { effectiveDate: '2026-09-23', closingDate: '2026-10-30', financing: 'financed' as const, depositDays: 3, inspectionDays: 15, loanApplicationDays: 5, loanApprovalDays: 30 };

function repository() {
  return createMemoryOperationalSignalRepository(
    { get: vi.fn(async () => undefined) } as unknown as ContactRepository,
    { list: vi.fn(async () => [transaction]) } as unknown as TransactionRepository,
  );
}

describe('createContractTimelineCommand', () => {
  it('saves every confirmed date as a verified contract milestone at 11:59 PM local', async () => {
    const repo = repository();
    const result = await createContractTimelineCommand(repo, scope, { transactionId: transaction.id, timeline, confirmed: true, timeZone: 'America/New_York' });
    expect(result).toEqual({ created: 5, skipped: 0 });
    const inspection = (await repo.listMilestones(scope)).find((item) => item.label === 'Inspection period ends');
    expect(inspection).toMatchObject({ kind: 'inspection', dueAt: '2026-10-09T03:59:00.000Z', sourceType: 'contract', verificationState: 'verified', sourceDate: '2026-09-23' });
  });

  it('never duplicates dates already on the deal and requires confirmation', async () => {
    const repo = repository();
    await createContractTimelineCommand(repo, scope, { transactionId: transaction.id, timeline, confirmed: true, timeZone: 'America/New_York' });
    expect(await createContractTimelineCommand(repo, scope, { transactionId: transaction.id, timeline, confirmed: true, timeZone: 'America/New_York' })).toEqual({ created: 0, skipped: 5 });
    await expect(createContractTimelineCommand(repo, scope, { transactionId: transaction.id, timeline, confirmed: false, timeZone: 'America/New_York' })).rejects.toThrow(/Confirm/);
  });
});
