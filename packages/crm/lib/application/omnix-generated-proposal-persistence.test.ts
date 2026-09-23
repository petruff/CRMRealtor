import { describe, expect, it } from 'vitest';
import { createMemoryOmnixProposalRepository } from '../data/memory-omnix-proposal-repository.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import type { Contact } from '../domain/contact.ts';
import type { OmnixCopilotSuccessResponse } from '../domain/omnix-copilot.ts';
import { persistGeneratedOmnixProposals } from './omnix-generated-proposal-persistence.ts';

const contact: Contact = { id: 'contact-a', firstName: 'Alicia', lastName: 'Buyer', leadType: 'hot',
  relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'contacted', tags: [],
  createdAt: '2026-08-01T00:00:00.000Z' };
const response = {
  ok: true, schemaVersion: 'omnix-copilot.v1', command: 'ask', resolvedIntent: { kind: 'brief', date: 'today' },
  correlationId: '65000000-0000-4000-8000-000000000001', dataMode: 'sample', asOf: '2026-08-31T12:00:00.000Z',
  answerBlocks: [], suggestions: [], warnings: [], alerts: [],
  citations: [{ id: 'citation-a', schemaVersion: 'citation.v1', entityType: 'contact', recordId: contact.id,
    factKeys: ['leadType', 'nextTouchAt'], responseAsOf: '2026-08-31T12:00:00.000Z', target: `/contacts/${contact.id}` }],
} satisfies OmnixCopilotSuccessResponse;

describe('generated proposal persistence', () => {
  it('routes a cited follow-up to explicit date review without inventing a commitment', async () => {
    const repository = createMemoryOmnixProposalRepository();
    const result = await persistGeneratedOmnixProposals({ repository, scope: SAMPLE_WORKSPACE_SCOPE, contacts: [contact], response,
      narrative: { state: 'available', policyVersion: 'omnix-ai-policy.v1', highlights: [], unknowns: [],
        proposals: [{ kind: 'follow-up', title: 'Call Alicia', text: 'The hot lead needs a follow-up.',
          preview: 'Call Alicia tomorrow.', href: `/contacts/${contact.id}`, citationIds: ['citation-a'] }] },
      now: new Date('2026-08-31T12:00:00.000Z') });
    expect(result).toEqual([{ state: 'review-required', reason: 'date-confirmation-required', reviewHref: '/contacts/contact-a/outcome' }]);
    await expect(repository.list(SAMPLE_WORKSPACE_SCOPE, { state: 'active', limit: 10 })).resolves.toEqual([]);
  });

  it('returns exact immutable draft review identity, full preview, and stable idempotent receipts', async () => {
    const repository = createMemoryOmnixProposalRepository();
    const input = { repository, scope: SAMPLE_WORKSPACE_SCOPE, contacts: [contact], response,
      narrative: { state: 'available' as const, policyVersion: 'omnix-ai-policy.v1' as const, highlights: [], unknowns: [],
        proposals: [{ kind: 'email-draft' as const, title: 'Checking in', text: 'Proposed follow-up', preview: 'Hi Alicia, which dates work for you?', href: '/contacts/contact-a', citationIds: ['citation-a'] }] },
      now: new Date('2026-08-31T12:00:00.000Z') };
    const first = (await persistGeneratedOmnixProposals(input))[0]!;
    expect(first.state).toBe('persisted');
    if (first.state !== 'persisted') throw new Error('Expected draft');
    expect(first.reviewHref).toBe(`/approvals?proposalId=${first.proposalId}#proposal-${first.proposalId}`);
    expect((await repository.getVersion(SAMPLE_WORKSPACE_SCOPE, first.proposalId, first.version))?.payload)
      .toEqual({ contactId: contact.id, subject: 'Checking in', body: 'Hi Alicia, which dates work for you?', targetResolutionRequired: true });
    expect((await repository.get(SAMPLE_WORKSPACE_SCOPE, first.proposalId))?.dueAt).toBeUndefined();
    expect((await persistGeneratedOmnixProposals(input))[0]).toEqual({ ...first, noOp: true });
  });

  it('does not choose among multiple contacts or silently drop invalid citations', async () => {
    const repository = createMemoryOmnixProposalRepository();
    const other = { ...contact, id: 'contact-b' };
    const result = await persistGeneratedOmnixProposals({ repository, scope: SAMPLE_WORKSPACE_SCOPE, contacts: [contact, other],
      response: { ...response, citations: [...response.citations, { ...response.citations[0]!, id: 'citation-b', recordId: other.id, target: '/contacts/contact-b' }] },
      narrative: { state: 'available', policyVersion: 'omnix-ai-policy.v1', highlights: [], unknowns: [], proposals:
        [['citation-a', 'citation-b'], ['citation-a', 'invented']].map((citationIds) => ({ kind: 'email-draft', title: 'Check in', text: 'Proposed follow-up', preview: 'Hello', href: '/', citationIds })) },
      now: new Date('2026-08-31T12:00:00.000Z') });
    expect(result).toEqual([{ state: 'skipped', reason: 'ambiguous-contact' }, { state: 'skipped', reason: 'missing-citation' }]);
    await expect(repository.list(SAMPLE_WORKSPACE_SCOPE, { state: 'all', limit: 10 })).resolves.toEqual([]);
  });
});
