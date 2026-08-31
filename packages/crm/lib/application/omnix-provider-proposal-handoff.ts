import { hashOmnixProposalPayload } from './omnix-proposal-commands.ts';
import { OmnixOperationalError, type OmnixProposalKind } from '../domain/omnix-operational-brain.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { OmnixProposalRepository } from '../data/omnix-proposal-repository.ts';

export type OmnixProviderProposalKind = Extract<OmnixProposalKind,
  'google-email-draft' | 'google-calendar-event' | 'mailchimp-campaign-draft'>;

export interface OmnixProviderHandoffGateway {
  prepare(input: {
    readonly proposalId: string;
    readonly version: number;
    readonly kind: OmnixProviderProposalKind;
    readonly contactId?: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly rationale: string;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<{ readonly executionReference: string }>;
}

function errorCategory(error: unknown): string {
  if (error instanceof OmnixOperationalError) return `handoff.${error.code}`;
  const candidate = error as { code?: unknown };
  return typeof candidate?.code === 'string' && /^[a-z][a-z0-9_.-]{1,60}$/u.test(candidate.code)
    ? `connector.${candidate.code}` : 'connector.handoff-failed';
}

export async function handoffApprovedOmnixProviderProposalCommand(
  proposals: OmnixProposalRepository,
  gateway: OmnixProviderHandoffGateway,
  scope: WorkspaceScope,
  proposalId: string,
  now = new Date(),
) {
  const proposal = await proposals.get(scope, proposalId);
  if (!proposal) throw new OmnixOperationalError('not-found', 'Approved proposal was not found.');
  if (proposal.state !== 'approved' && proposal.state !== 'failed' && proposal.state !== 'executing') {
    throw new OmnixOperationalError('conflict', 'Proposal is not approved for connector handoff.');
  }
  if (!['google-email-draft', 'google-calendar-event', 'mailchimp-campaign-draft'].includes(proposal.kind)) {
    throw new OmnixOperationalError('unavailable', 'This proposal does not use a provider handoff.');
  }
  const version = await proposals.getVersion(scope, proposal.id, proposal.currentVersion);
  if (!version || hashOmnixProposalPayload(version.payload) !== version.contentHash) {
    throw new OmnixOperationalError('conflict', 'Proposal content changed before connector handoff.');
  }
  const attempt = proposal.state === 'failed' ? Date.parse(proposal.updatedAt) : proposal.currentVersion;
  const baseKey = `handoff:${proposal.id}:${attempt}`;
  if (proposal.state === 'approved' || proposal.state === 'failed') {
    await proposals.transitionExecution(scope, proposal.id, {
      expectedState: proposal.state, nextState: 'executing',
      idempotencyKey: proposal.state === 'failed' ? `${baseKey}:retry` : `${baseKey}:claim`,
      occurredAt: now.toISOString(),
    });
  }
  try {
    const result = await gateway.prepare({
      proposalId: proposal.id,
      version: proposal.currentVersion,
      kind: proposal.kind as OmnixProviderProposalKind,
      ...(proposal.contactId ? { contactId: proposal.contactId } : {}),
      payload: version.payload,
      rationale: proposal.rationale,
      correlationId: proposal.correlationId,
      occurredAt: now.toISOString(),
    });
    if (!/^[a-z][a-z0-9-]{1,40}:[A-Za-z0-9._:-]{1,200}$/u.test(result.executionReference)) {
      throw new OmnixOperationalError('conflict', 'Connector handoff returned an invalid reference.');
    }
    return proposals.transitionExecution(scope, proposal.id, {
      expectedState: 'executing', nextState: 'executed', executionReference: result.executionReference,
      idempotencyKey: `${baseKey}:complete`, occurredAt: now.toISOString(),
    });
  } catch (error) {
    await proposals.transitionExecution(scope, proposal.id, {
      expectedState: 'executing', nextState: 'failed', errorCategory: errorCategory(error),
      idempotencyKey: `${baseKey}:failed`, occurredAt: now.toISOString(),
    }).catch(() => undefined);
    throw error;
  }
}
