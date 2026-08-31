'use server';

import { revalidatePath } from 'next/cache';
import { decideOmnixProposalCommand } from '@/lib/application/omnix-proposal-commands';
import { executeApprovedOmnixProposalCommand } from '@/lib/application/omnix-proposal-executor';
import { handoffApprovedOmnixProviderProposalCommand } from '@/lib/application/omnix-provider-proposal-handoff';
import { createOmnixProviderServerGateway } from '@/lib/application/omnix-provider-server-gateway';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function executeProposal(proposalId: string): Promise<void> {
  const context = await getRepository();
  const proposal = await context.omnixProposalRepository.get(context.workspaceScope, proposalId);
  if (proposal?.kind === 'task-create' || proposal?.kind === 'pipeline-move' || proposal?.kind === 'nurture-plan') {
    await executeApprovedOmnixProposalCommand({
      proposals: context.omnixProposalRepository,
      activities: context.activityRepository,
      pipeline: context.pipelineRepository,
      nurture: context.nurturePlanRepository,
      operationalSignals: context.operationalSignalRepository,
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
  const receipt = await decideOmnixProposalCommand(context.omnixProposalRepository, context.workspaceScope, proposalId, {
    decision,
    expectedVersion: version,
    idempotencyKey: `${decision}:${proposalId}:${version}`,
  });
  if (decision === 'approve' && receipt.state === 'approved') {
    await executeProposal(proposalId).catch((error: unknown) => {
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
  if (typeof proposalId !== 'string') throw new Error('The proposal retry is invalid.');
  await executeProposal(proposalId).catch((error: unknown) => {
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
