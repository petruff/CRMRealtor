import type { Contact } from '../domain/contact.ts';
import type { OmnixCopilotSuccessResponse } from '../domain/omnix-copilot.ts';
import type { OmnixGeneratedProposal, OmnixGenerativeResult } from './omnix-generative-narrator.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalRepository } from '../data/omnix-proposal-repository.ts';
import type { OmnixProposalCitation } from '../domain/omnix-operational-brain.ts';
import { createOmnixProposalCommand } from './omnix-proposal-commands.ts';

function kind(proposal: OmnixGeneratedProposal) {
  if (proposal.kind === 'follow-up') return 'task-create' as const;
  if (proposal.kind === 'email-draft') return 'google-email-draft' as const;
  return 'mailchimp-campaign-draft' as const;
}

export async function persistGeneratedOmnixProposals(input: {
  readonly repository: OmnixProposalRepository;
  readonly scope: WorkspaceScope;
  readonly contacts: readonly Contact[];
  readonly response: OmnixCopilotSuccessResponse;
  readonly narrative: OmnixGenerativeResult;
  readonly now: Date;
}) {
  if (input.narrative.state !== 'available' || input.narrative.proposals.length === 0) return [];
  const citations = new Map(input.response.citations.map((citation) => [citation.id, citation]));
  const contacts = new Map(input.contacts.map((contact) => [contact.id, contact]));
  return Promise.all(input.narrative.proposals.map(async (proposal, index) => {
    const selected = proposal.citationIds.flatMap((id) => {
      const citation = citations.get(id);
      if (!citation) return [];
      const entityType = citation.entityType === 'connector' ? 'connection'
        : citation.entityType === 'contact' || citation.entityType === 'task' || citation.entityType === 'activity'
          ? citation.entityType : 'workspace';
      return [{
        entityType, recordId: citation.recordId, factKeys: citation.factKeys,
        ...(citation.sourceTimestamp ? { sourceTimestamp: citation.sourceTimestamp } : {}), href: citation.target,
      } satisfies OmnixProposalCitation];
    });
    if (selected.length === 0) return { state: 'skipped' as const, reason: 'missing-citation' as const };
    const contactCitation = proposal.citationIds.map((id) => citations.get(id))
      .find((citation) => citation?.entityType === 'contact');
    const contact = contactCitation ? contacts.get(contactCitation.recordId) : undefined;
    if ((proposal.kind === 'follow-up' || proposal.kind === 'email-draft') && !contact) {
      return { state: 'skipped' as const, reason: 'missing-contact' as const };
    }
    const dueAt = new Date(input.now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const payload = proposal.kind === 'follow-up'
      ? { contactId: contact!.id, title: proposal.title, description: proposal.text, dueAt }
      : proposal.kind === 'email-draft'
        ? { contactId: contact!.id, subject: proposal.title, body: proposal.preview, targetResolutionRequired: true }
        : { title: proposal.title, message: proposal.preview, segment: 'all-subscribers', audienceReviewRequired: true };
    const receipt = await createOmnixProposalCommand(input.repository, input.scope, {
      ...(contact ? { contactId: contact.id } : {}), kind: kind(proposal), origin: 'gemini',
      approvalMode: proposal.kind === 'follow-up' ? 'active-member' : 'owner',
      factors: {
        urgency: proposal.kind === 'follow-up' ? 70 : 45,
        leadTemperature: contact?.leadType ?? 'unknown', daysOverdue: 0,
        awaitingReply: false, potentialValueCents: 0,
      },
      title: proposal.title, rationale: proposal.text, payload, citations: selected,
      ...(proposal.kind === 'follow-up' ? { dueAt } : {}),
      expiresAt: new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      correlationId: input.response.correlationId,
      idempotencyKey: `gemini:${input.response.correlationId}:${index + 1}`,
    }, input.now);
    return { state: 'persisted' as const, ...receipt };
  }));
}
