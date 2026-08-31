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
  it('turns a cited Gemini follow-up into a durable review item', async () => {
    const repository = createMemoryOmnixProposalRepository();
    await persistGeneratedOmnixProposals({ repository, scope: SAMPLE_WORKSPACE_SCOPE, contacts: [contact], response,
      narrative: { state: 'available', policyVersion: 'omnix-ai-policy.v1', highlights: [], unknowns: [],
        proposals: [{ kind: 'follow-up', title: 'Call Alicia', text: 'The hot lead needs a follow-up.',
          preview: 'Call Alicia tomorrow.', href: `/contacts/${contact.id}`, citationIds: ['citation-a'] }] },
      now: new Date('2026-08-31T12:00:00.000Z') });
    await expect(repository.list(SAMPLE_WORKSPACE_SCOPE, { state: 'active', limit: 10 }))
      .resolves.toMatchObject([{ kind: 'task-create', origin: 'gemini', contactId: contact.id }]);
  });
});
