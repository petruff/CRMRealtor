import { describe, expect, it, vi } from 'vitest';
import { exportCaptureOutcome } from './capture-outcome-export';
import { SAMPLE_WORKSPACE_SCOPE as scope } from '../domain/workspace';
import type { CaptureOutcomeProposal } from '../domain/capture-outcome';
import type { CaptureOutcomeRepository } from '../data/capture-outcome-repository';
import type { ContactRepository } from '../data/repository';

const proposal = { id: 'review-1', contactId: 'contact-1', workspaceId: scope.workspaceId, version: 2,
  contentHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), status: 'completed', createdAt: '2026-09-07',
  sourceText: 'Confidential conversation', summary: 'Confidential summary', facts: [{ text: 'Private fact' }],
  operations: [{ id: 'op1', type: 'note-append', state: 'completed', selected: true, after: { text: 'Private note' }, receipt: 'note:1' }],
} as unknown as CaptureOutcomeProposal;
function fixture(value = proposal) {
  return { scope, contacts: { get: vi.fn().mockResolvedValue({ id: 'contact-1' }) } as unknown as ContactRepository,
    captures: { get: vi.fn().mockResolvedValue(value) } as unknown as CaptureOutcomeRepository,
    recordReceipt: vi.fn().mockResolvedValue(undefined) };
}
describe('single review export', () => {
  it('defaults to metadata and excludes all source-derived text', async () => {
    const deps = fixture(); const result = await exportCaptureOutcome(deps, { contactId: 'alias-id', proposalId: 'review-1' });
    expect(result.body).not.toMatch(/Confidential conversation|Confidential summary|Private fact|Private note/);
    expect(JSON.parse(result.body).scope).toBe('current-review-only');
    expect(deps.recordReceipt).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ includeSource: false, version: 2 }) }));
  });
  it('exports raw review only on explicit selection without putting raw text in receipt', async () => {
    const deps = fixture(); const result = await exportCaptureOutcome(deps, { contactId: 'contact-1', proposalId: 'review-1', includeSource: true });
    expect(JSON.parse(result.body).review.sourceText).toBe(proposal.sourceText);
    expect(JSON.stringify(deps.recordReceipt.mock.calls)).not.toMatch(/Confidential|Private/);
  });
  it.each([{ ...proposal, workspaceId: 'foreign' }, { ...proposal, contactId: 'foreign' }])('rejects cross-scope records', async (value) => {
    const deps = fixture(value);
    await expect(exportCaptureOutcome(deps, { contactId: 'contact-1', proposalId: 'review-1' })).rejects.toMatchObject({ code: 'not-found' });
    expect(deps.recordReceipt).not.toHaveBeenCalled();
  });
  it('releases no export if its receipt fails', async () => {
    const deps = fixture(); deps.recordReceipt.mockRejectedValue(new Error('receipt-unavailable'));
    await expect(exportCaptureOutcome(deps, { contactId: 'contact-1', proposalId: 'review-1' })).rejects.toThrow('receipt-unavailable');
  });
  it('never serializes unknown parent or nested internal fields even with source included', async () => {
    const poisoned = { ...proposal, internalSecret: 'do-not-export', operations: proposal.operations.map(operation => ({ ...operation, providerBlob: 'do-not-export', after: { ...operation.after, secret: 'do-not-export' } })) };
    const result = await exportCaptureOutcome(fixture(poisoned), { contactId: 'contact-1', proposalId: 'review-1', includeSource: true });
    expect(result.body).not.toContain('do-not-export');
  });
  it.each([
    { ...proposal, unknowns: [{ providerBlob: 'secret' }] },
    { ...proposal, operations: [{ ...proposal.operations[0], after: { title: { internalSecret: 'secret' } } }] },
  ])('fails closed on nested values in primitive fields', async (malformed) => {
    const deps = fixture(malformed as unknown as CaptureOutcomeProposal);
    await expect(exportCaptureOutcome(deps, { contactId: 'contact-1', proposalId: 'review-1', includeSource: true })).rejects.toMatchObject({ code: 'unavailable' });
    expect(deps.recordReceipt).not.toHaveBeenCalled();
  });
});
