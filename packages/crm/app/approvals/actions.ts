'use server';

import { revalidatePath } from 'next/cache';
import { decideOmnixProposalCommand, hashOmnixProposalPayload } from '@/lib/application/omnix-proposal-commands';
import { executeApprovedOmnixProposalCommand } from '@/lib/application/omnix-proposal-executor';
import { handoffApprovedOmnixProviderProposalCommand } from '@/lib/application/omnix-provider-proposal-handoff';
import { createOmnixProviderServerGateway } from '@/lib/application/omnix-provider-server-gateway';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function executeProposal(proposalId: string, expectedVersion: number): Promise<void> {
  const context = await getRepository();
  const proposal = await context.omnixProposalRepository.get(context.workspaceScope, proposalId);
  const saved = proposal ? await context.omnixProposalRepository.getVersion(context.workspaceScope, proposalId, expectedVersion) : undefined;
  if (!proposal || !saved || proposal.currentVersion !== expectedVersion || saved.version !== expectedVersion || saved.proposalId !== proposalId
    || hashOmnixProposalPayload(saved.payload) !== saved.contentHash || !(Date.parse(proposal.expiresAt) > Date.now())
    || saved.payload.targetResolutionRequired === true || saved.payload.audienceReviewRequired === true) {
    throw new Error('This action is unavailable or needs a fresh review.');
  }
  if (['note-append', 'task-create', 'pipeline-move', 'nurture-plan', 'nurture-transition'].includes(proposal.kind)) {
    // Same recovery seam as capture: failed records retain their original approval.
    // The scoped repository checks role, prior approval and expected state before the executor recovers its receipt.
    if (proposal.state === 'failed') {
      await context.omnixProposalRepository.transitionExecution(context.workspaceScope, proposalId, {
        expectedState: 'failed', nextState: 'executing', idempotencyKey: `approval-retry:${proposalId}:${expectedVersion}:${proposal.updatedAt}`,
        occurredAt: new Date().toISOString(),
      });
    }
    await executeApprovedOmnixProposalCommand({
      proposals: context.omnixProposalRepository,
      activities: context.activityRepository,
      pipeline: context.pipelineRepository,
      nurture: context.nurturePlanRepository,
      operationalSignals: context.operationalSignalRepository,
      captureOutcomes: context.captureOutcomeRepository,
    }, context.workspaceScope, proposalId);
    return;
  }
  if (proposal && ['google-email-draft', 'google-calendar-event', 'mailchimp-campaign-draft'].includes(proposal.kind)) {
    const authenticated = await createSupabaseServerClient();
    await handoffApprovedOmnixProviderProposalCommand(
      context.omnixProposalRepository,
      createOmnixProviderServerGateway(context, authenticated),
      context.workspaceScope,
      proposalId,
    );
  }
}

export async function decideOmnixProposalAction(formData: FormData): Promise<void> {
  const decision = formData.get('decision');
  const proposalId = formData.get('proposalId');
  const version = Number(formData.get('version'));
  if ((decision !== 'approve' && decision !== 'reject') || typeof proposalId !== 'string') {
    throw new Error('The proposal decision is invalid.');
  }
  const context = await getRepository();
  if (decision === 'approve') {
    const proposal = await context.omnixProposalRepository.get(context.workspaceScope, proposalId);
    const saved = proposal ? await context.omnixProposalRepository.getVersion(context.workspaceScope, proposalId, version) : undefined;
    if (!proposal || !saved || saved.proposalId !== proposalId || saved.version !== version || proposal.currentVersion !== version
      || hashOmnixProposalPayload(saved.payload) !== saved.contentHash || !(Date.parse(proposal.expiresAt) > Date.now())) {
      throw new Error('This proposal changed or expired. Open a fresh review.');
    }
    if (saved.payload.targetResolutionRequired === true || saved.payload.audienceReviewRequired === true) {
      throw new Error('Review the exact sender, recipient, or audience before approving this draft.');
    }
  }
  const receipt = await decideOmnixProposalCommand(context.omnixProposalRepository, context.workspaceScope, proposalId, {
    decision,
    expectedVersion: version,
    idempotencyKey: `${decision}:${proposalId}:${version}`,
  });
  if (decision === 'approve' && receipt.state === 'approved') {
    await executeProposal(proposalId, version).catch((error: unknown) => {
      console.error(JSON.stringify({
        schemaVersion: 'omnix-provider-handoff-error.v1', proposalId,
        category: error instanceof Error ? error.name : 'unknown',
      }));
    });
  }
  revalidatePath('/approvals');
  revalidatePath('/omnix');
  revalidatePath('/campaigns');
  revalidatePath('/connections');
}

export async function retryOmnixProposalAction(formData: FormData): Promise<void> {
  const proposalId = formData.get('proposalId');
  const version = Number(formData.get('version'));
  if (typeof proposalId !== 'string' || !Number.isInteger(version) || version < 1) throw new Error('The proposal retry is invalid.');
  await executeProposal(proposalId, version).catch((error: unknown) => {
    console.error(JSON.stringify({
      schemaVersion: 'omnix-provider-handoff-retry-error.v1', proposalId,
      category: error instanceof Error ? error.name : 'unknown',
    }));
  });
  revalidatePath('/approvals');
  revalidatePath('/campaigns');
  revalidatePath('/connections');
}

export async function acknowledgeInboundResponseAction(formData: FormData): Promise<void> {
  const signalId = formData.get('signalId');
  if (typeof signalId !== 'string') throw new Error('The reply review is invalid.');
  const context = await getRepository();
  await context.operationalSignalRepository.acknowledgeInbound(
    context.workspaceScope, signalId, new Date().toISOString(),
  );
  revalidatePath('/approvals');
  revalidatePath('/');
}
