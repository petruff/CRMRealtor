import { describe, expect, it, vi } from 'vitest';
import { createCaptureOutcomeService } from './capture-outcome-service';
import { createMemoryCaptureOutcomeRepository } from '../data/memory-capture-outcome-repository';
import { createMemoryOmnixProposalRepository } from '../data/memory-omnix-proposal-repository';
import { createMemoryActivityRepository } from '../data/memory-activity-repository';
import { createMemoryPipelineRepository } from '../data/memory-pipeline-repository';
import { createMemoryNurturePlanRepository } from '../data/memory-nurture-plan-repository';
import type { ContactRepository } from '../data/repository';
import type { RichContactRepository } from '../data/rich-contact-repository';
import type { ConnectorRepository } from '../data/connector-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
const scope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' as const };
const now = new Date('2026-09-07T15:00:00Z');
function fixture() {
  const contacts = { get: async () => ({ id: 'c1', firstName: 'Client', lastName: 'Name', emailSubscribed: true, pipelineStage: 'new', createdAt: now.toISOString() }), addNote: vi.fn().mockResolvedValue({ id: 'n1' }) } as unknown as ContactRepository;
  const proposals = createMemoryOmnixProposalRepository(); const activities = createMemoryActivityRepository();
  const captures = createMemoryCaptureOutcomeRepository(contacts, proposals, activities);
  const providerGateway = { prepare: vi.fn().mockResolvedValue({ executionReference: 'connector-intent:intent1' }) };
  const connectors = { listConnections: async () => [{ id: 'g1', workspaceId: scope.workspaceId, provider: 'google', status: 'active', remoteAccountLabel: 'owner@test.invalid', grantedScopes: ['https://www.googleapis.com/auth/gmail.send'], updatedAt: now.toISOString() }] } as unknown as ConnectorRepository;
  const richContacts = { listContactPoints: async () => [{ id: 'e1', workspaceId: scope.workspaceId, contactId: 'c1', type: 'email', normalizedValue: 'client@test.invalid', emailSubscribed: true, updatedAt: now.toISOString() }] } as unknown as RichContactRepository;
  const service = createCaptureOutcomeService({ contacts, proposals, activities, captures, pipeline: createMemoryPipelineRepository({ contacts, activities }), nurture: createMemoryNurturePlanRepository(), connectors, richContacts, outboundGuard: { assertTarget: async () => ({ contactId: 'c1', aliasEpoch: 0 }) }, providerGateway });
  return { service, providerGateway, proposals };
}
describe('Capture provider preparation state', () => {
  it('returns awaiting-provider rather than completed, and replay never invokes gateway twice', async () => {
    const f = fixture(); let review = await f.service.analyze(scope, { contactId: 'c1', sourceText: 'We discussed the next showing.', idempotencyKey: 'provider', manualOnly: true }, now);
    review = await f.service.addOperation(scope, review.id, 1, { type: 'google-email-draft', after: { connectionId: 'g1', contactPointId: 'e1', subject: 'Next showing', body: 'Thank you for discussing the next showing.' } }, now);
    expect(review.operations[1]!.before).toMatchObject({ recipient: 'client@test.invalid' });
    await expect(f.service.select({ ...scope, role: 'assistant' }, review.id, review.version, [review.operations[1]!.id], now)).rejects.toMatchObject({ code: 'forbidden' });
    review = await f.service.select(scope, review.id, review.version, [review.operations[1]!.id], now);
    const prepared = await f.service.confirm(scope, review.id, review.version, review.contentHash, now);
    expect(prepared.status).toBe('awaiting-provider'); expect(prepared.operations[1]!.state).toBe('awaiting-provider');
    expect((await f.proposals.get(scope, prepared.operations[1]!.childProposalId!))?.approvalMode).toBe('owner');
    expect(await f.service.confirm(scope, review.id, review.version, review.contentHash, new Date('2027-01-01'))).toEqual(prepared);
    expect(f.providerGateway.prepare).toHaveBeenCalledTimes(1);
  });
  it('does not allow a draft selection when recap explicitly opts out despite stored subscription', async () => {
    const f = fixture(); let review = await f.service.analyze(scope, { contactId: 'c1', sourceText: 'Don’t\nemail me.', idempotencyKey: 'blocked', manualOnly: true }, now);
    review = await f.service.addOperation(scope, review.id, 1, { type: 'google-email-draft', after: { connectionId: 'g1', contactPointId: 'e1', subject: 'Follow-up', body: 'The recap.' } }, now);
    await expect(f.service.select(scope, review.id, review.version, [review.operations[1]!.id], now)).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.providerGateway.prepare).not.toHaveBeenCalled();
  });
});
