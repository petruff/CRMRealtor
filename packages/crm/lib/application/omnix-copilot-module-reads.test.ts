import { describe, expect, it, vi } from 'vitest';
import { readOmnixModules, type OmnixModuleRepositories } from './omnix-copilot-module-reads';
import { memoryRepository } from '../data/memory-repository';
import { createMemoryTransactionRepository } from '../data/memory-transaction-repository';
import { createMemoryNurturePlanRepository } from '../data/memory-nurture-plan-repository';
import { createMemoryOmnixProposalRepository } from '../data/memory-omnix-proposal-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import type { PropertyRepository } from '../data/property-repository';
import type { PropertyFact, PropertyIdentity } from '../domain/property';
import type { TransactionFinancialAuthority } from '../domain/transaction-finance';
import { createOmnixCopilotRequest } from '../domain/omnix-copilot';
import { executeOmnixCopilot } from './omnix-copilot-service';
import { queryContacts } from './contact-query';
import type { ContactRepository } from '../data/repository';
import { passthroughContactIdentityMap } from '../data/contact-identity-map';
const scope = SAMPLE_WORKSPACE_SCOPE, asOf = '2026-09-07T12:00:00.000Z';
async function fixture() {
  const base = memoryRepository();
  const contacts = (await base.list()).map((row, index) => ({ ...row, id: `94000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
  const repository = { ...base, list: async () => contacts, get: async (id: string) => contacts.find((row) => row.id === id), listPage: async (request: { query?: string; offset: number; limit: number }) => {
    const found = queryContacts(contacts, { query: request.query, scope: 'all' });
    return { items: found.slice(request.offset, request.offset + request.limit), total: found.length, activeTotal: contacts.length, scopeCounts: {} as never, leadTypeCounts: {} as never, offset: request.offset, limit: request.limit, aliasEpoch: 0 };
  } }; const contact = contacts[0]!;
  const transactions = createMemoryTransactionRepository(repository);
  const transaction = await transactions.create(scope, { contactId: contact.id, kind: 'buyer', title: 'Recorded purchase', side: 'buyer', status: 'under-contract', propertyAddress: '123 Test Lane', expectedCloseDate: '2026-09-30', salePriceCents: 35000000, grossCommissionCents: 900000, netCommissionCents: 700000, marketingCostCents: 10000, expenseCents: 20000, idempotencyKey: '95000000-0000-4000-8000-000000000001' });
  const context: OmnixModuleRepositories = { repository, transactionRepository: transactions, nurturePlanRepository: createMemoryNurturePlanRepository(), omnixProposalRepository: createMemoryOmnixProposalRepository() };
  return { context, contact, transaction, transactions };
}
describe('bounded Omnix canonical module reads', () => {
  it('reads the real sample repository within its 100-record page contract', async () => {
    const repository = memoryRepository() as ContactRepository & Required<Pick<ContactRepository, 'listPage'>>; const page = vi.spyOn(repository, 'listPage');
    const result = await readOmnixModules({ repository }, scope, { kind: 'workspace-overview' }, asOf);
    expect(result.warnings.map((row) => row.code)).not.toContain('contacts-unavailable');
    expect(result.answerBlocks[0]?.items.length).toBeGreaterThan(0);
    expect(page.mock.calls.every(([input]) => input.limit <= 100)).toBe(true);
  });
  it('separates contact relationship status from transaction lifecycle without reading raw notes', async () => {
    const f = await fixture(); const noteRead = vi.spyOn(f.context.repository, 'notesFor');
    const response = await readOmnixModules(f.context, scope, { kind: 'client-status', query: f.contact.id }, asOf);
    expect(response.answerBlocks.find((row) => row.id === 'module-contacts')?.items[0]?.detail).toContain('Stage: ');
    expect(response.answerBlocks.find((row) => row.id === 'module-transactions')?.items[0]?.detail).toContain('Transaction: under-contract');
    expect(response.answerBlocks.flatMap((row) => row.citations).some((row) => row.entityType === 'transaction')).toBe(true);
    expect(response.warnings.map((row) => row.code)).toContain('tasks-unavailable');
    expect(noteRead).not.toHaveBeenCalled();
  });
  it('matches a client linked through a canonical transaction party and ignores archived parties', async () => {
    const f = await fixture(); const other = (await f.context.repository.list())[1]!;
    const party = await f.transactions.addParty(scope, { transactionId: f.transaction.id, contactId: other.id, role: 'co-client', displayLabel: 'Co-client', participatesInCommunication: false, idempotencyKey: '95000000-0000-4000-8000-000000000002' }, asOf);
    expect((await readOmnixModules(f.context, scope, { kind: 'transactions', query: other.id }, asOf)).answerBlocks[0]?.items).toHaveLength(1);
    await f.transactions.archiveParty(scope, { partyId: party.id, expectedVersion: party.version, reasonCode: 'not-a-party', idempotencyKey: '95000000-0000-4000-8000-000000000003' }, asOf);
    expect((await readOmnixModules(f.context, scope, { kind: 'transactions', query: other.id }, asOf)).answerBlocks[0]?.items).toHaveLength(0);
  });
  it('resolves canonical aliases and refuses to fan out ambiguous or unknown contact matches', async () => {
    const f = await fixture(); const get = f.context.repository.get.bind(f.context.repository);
    vi.spyOn(f.context.repository, 'get').mockImplementation((id) => id === 'merged-alias' ? Promise.resolve(f.contact) : get(id));
    expect((await readOmnixModules(f.context, scope, { kind: 'transactions', query: 'merged-alias' }, asOf)).answerBlocks[0]?.items).toHaveLength(1);
    const list = vi.spyOn(f.transactions, 'list'); list.mockClear();
    const result = await readOmnixModules(f.context, scope, { kind: 'client-status', query: 'NoSuchClient' }, asOf);
    expect(result.answerBlocks[0]?.id).toBe('client-resolution'); expect(list).not.toHaveBeenCalled();
    const contacts = await f.context.repository.list();
    vi.spyOn(f.context.repository as ContactRepository & Required<Pick<ContactRepository, 'listPage'>>, 'listPage').mockResolvedValue({ items: contacts.slice(0, 2), total: 2, activeTotal: 2, scopeCounts: {} as never, leadTypeCounts: {} as never, offset: 0, limit: 6, aliasEpoch: 0 });
    expect((await readOmnixModules(f.context, scope, { kind: 'client-status', query: 'Smith' }, asOf)).answerBlocks[0]?.items).toHaveLength(2); expect(list).not.toHaveBeenCalled();
  });
  it('does not expose foreign module rows returned by a faulty adapter', async () => {
    const f = await fixture(); vi.spyOn(f.transactions, 'list').mockResolvedValue([{ ...f.transaction, id: 'foreign', workspaceId: 'other-workspace', title: 'Foreign private record' }]);
    const result = await readOmnixModules(f.context, scope, { kind: 'transactions' }, asOf);
    expect(JSON.stringify(result)).not.toContain('Foreign private record'); expect(result.answerBlocks[0]?.items).toHaveLength(0);
  });
  it('includes historical alias-owned transactions, plans, proposals and saved reviews in canonical client status', async () => {
    const f = await fixture(), alias = '94000000-0000-4000-8000-999999999999';
    const contactIdentityMap = { ...passthroughContactIdentityMap(), listGroupMembers: vi.fn(async () => ({ requestedContactId: f.contact.id, canonicalContactId: f.contact.id, memberContactIds: [f.contact.id, alias], aliasEpoch: 1 })), resolvePage: vi.fn(async () => new Map([[f.contact.id, f.contact.id], [alias, f.contact.id]])) };
    vi.spyOn(f.transactions, 'list').mockResolvedValue([{ ...f.transaction, contactId: alias }]);
    vi.spyOn(f.context.nurturePlanRepository!, 'list').mockImplementation(async (_scope, query) => query.contactId === alias ? [{ id: 'plan-historical', workspaceId: scope.workspaceId, contactId: alias, state: 'paused', cadenceDays: 14, currentStep: 1, maximumSteps: 4, updatedAt: asOf } as never] : []);
    vi.spyOn(f.context.omnixProposalRepository!, 'list').mockImplementation(async (_scope, query) => query.contactId === alias ? [{ id: 'proposal-historical', workspaceId: scope.workspaceId, contactId: alias, title: 'Historical task review', state: 'pending', currentVersion: 1, approvalMode: 'owner', expiresAt: asOf, updatedAt: asOf } as never] : []);
    const captureOutcomeRepository = { list: vi.fn(async (_scope, id) => id === alias ? [{ id: 'capture-historical', workspaceId: scope.workspaceId, contactId: alias, status: 'pending', version: 1, operations: [], createdAt: asOf }] : []) } as unknown as NonNullable<OmnixModuleRepositories['captureOutcomeRepository']>;
    const result = await readOmnixModules({ ...f.context, contactIdentityMap, captureOutcomeRepository }, scope, { kind: 'client-status', query: f.contact.id }, asOf);
    for (const area of ['transactions', 'nurture', 'proposals', 'capture']) expect(result.answerBlocks.find((row) => row.id === `module-${area}`)?.items).toHaveLength(1);
    expect(contactIdentityMap.listGroupMembers).toHaveBeenCalledWith(scope, f.contact.id);
    expect(result.answerBlocks.find((row) => row.id === 'module-proposals')?.items[0]?.href).toBe('/approvals?proposalId=proposal-historical#proposal-proposal-historical');
    expect(result.answerBlocks.find((row) => row.id === 'module-capture')?.items[0]?.href).toBe(`/contacts/${f.contact.id}`);
    expect(result.answerBlocks.find((row) => row.id === 'module-capture')?.items[0]?.detail).toContain('Reopening this historical review is not available here');
    expect(result.warnings.map((row) => row.code)).toContain('capture-history-unavailable');
  });
  it('refuses unverified or foreign alias groups before related reads', async () => {
    const f = await fixture(); const list = vi.spyOn(f.transactions, 'list');
    const contactIdentityMap = { ...passthroughContactIdentityMap(), listGroupMembers: async () => ({ requestedContactId: f.contact.id, canonicalContactId: f.contact.id, memberContactIds: [f.contact.id, 'foreign-contact'], aliasEpoch: 1 }) };
    const result = await readOmnixModules({ ...f.context, contactIdentityMap }, scope, { kind: 'transactions', query: f.contact.id }, asOf);
    expect(result.warnings[0]?.code).toBe('contact-group-unavailable'); expect(list).not.toHaveBeenCalled();
  });
  it('keeps a failing module unavailable while other aggregate modules remain useful', async () => {
    const f = await fixture(); vi.spyOn(f.transactions, 'list').mockRejectedValue(new Error('private-database-detail'));
    const result = await readOmnixModules(f.context, scope, { kind: 'workspace-overview' }, asOf);
    expect(result.answerBlocks.find((row) => row.id === 'module-transactions')?.kind).toBe('capability');
    expect(result.answerBlocks.find((row) => row.id === 'module-contacts')?.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('private-database-detail'); expect(result.warnings.map((row) => row.code)).toContain('transactions-unavailable');
  });
  it('caps reads and labels non-total transaction coverage', async () => {
    const f = await fixture(); vi.spyOn(f.transactions, 'list').mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({ ...f.transaction, id: `transaction-${index}` })));
    const result = await readOmnixModules(f.context, scope, { kind: 'transactions' }, asOf);
    expect(result.answerBlocks[0]?.items).toHaveLength(20); expect(result.warnings.map((row) => row.code)).toEqual(expect.arrayContaining(['transactions-coverage', 'transactions-truncated']));
  });
  it('labels missing and contradictory financial authority without substituting transaction forecasts', async () => {
    const f = await fixture(); const missing = await readOmnixModules(f.context, scope, { kind: 'finances' }, asOf);
    expect(missing.answerBlocks[0]?.items[0]?.detail).toContain('Financial authority is missing');
    const financial = { id: 'financial-1', workspaceId: scope.workspaceId, transactionId: f.transaction.id, grossCommissionCents: 123456, sourceType: 'manual-record', verificationState: 'contradictory', effectiveDate: '2026-09-07', updatedAt: asOf } as TransactionFinancialAuthority;
    vi.spyOn(f.transactions, 'listFinancials').mockResolvedValue([financial]);
    const result = await readOmnixModules(f.context, scope, { kind: 'finances' }, asOf);
    expect(result.answerBlocks[0]?.items[0]?.detail).toContain('$1,234.56'); expect(result.answerBlocks[0]?.items[0]?.detail).toContain('contradictory'); expect(result.answerBlocks[0]?.items[0]?.detail).toContain('not proof of received payment');
  });
  it('withholds expired, restricted and retention-expired licensed facts without leaking their values', async () => {
    const f = await fixture();
    const identity = { id: 'property-1', workspaceId: scope.workspaceId, addressLine1: 'Main Street', city: 'Miami', kind: 'condo', lifecycle: 'active', updatedAt: asOf } as PropertyIdentity;
    const base = { id: 'fact-1', workspaceId: scope.workspaceId, propertyId: identity.id, field: 'association-name', value: 'Allowed manual fact', authority: 'manual', permissionState: 'allowed', asOf, updatedAt: asOf } as PropertyFact;
    const facts = [base, { ...base, id: 'fact-2', value: 'restricted-secret', permissionState: 'restricted' }, { ...base, id: 'fact-3', value: 'expired-secret', displayUntil: '2026-09-06T00:00:00Z' }, { ...base, id: 'fact-4', value: 'retention-secret', retentionUntil: '2026-09-06T00:00:00Z' }, { ...base, id: 'fact-5', value: 'licensed-secret', authority: 'licensed-provider' }] as PropertyFact[];
    const propertyRepository = { list: vi.fn(async () => [identity]), listFacts: vi.fn(async () => facts) } as unknown as PropertyRepository;
    const result = await readOmnixModules({ ...f.context, propertyRepository }, scope, { kind: 'properties' }, asOf);
    expect(JSON.stringify(result)).toContain('Allowed manual fact'); expect(JSON.stringify(result)).not.toContain('-secret');
    expect(result.answerBlocks[0]?.citations.map((row) => row.entityType)).toContain('property-fact');
    expect(result.warnings.map((row) => row.code)).toContain('property-facts-unavailable');
  });
  it('uses shared service mode and membership validation before reading modules', async () => {
    const f = await fixture(); const list = vi.spyOn(f.transactions, 'list');
    const request = createOmnixCopilotRequest({ command: 'ask', question: 'transactions', live: true, now: new Date(asOf) });
    await expect(executeOmnixCopilot(request, { getRepository: async () => ({ ...f.context, workspaceScope: scope, isLive: false }), telemetry: async () => undefined })).rejects.toMatchObject({ code: 'forbidden' });
    expect(list).not.toHaveBeenCalled();
  });
});
