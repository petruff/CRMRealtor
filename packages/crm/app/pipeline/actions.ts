'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { moveContactPipelineStageCommand } from '@/lib/application/pipeline-commands';

export interface PipelineMoveActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly contactId?: string;
  readonly toStage?: string;
  readonly updatedAt?: string;
}

export async function movePipelineStageAction(input: {
  contactId: string; fromStage: string; toStage: string; expectedUpdatedAt: string; idempotencyKey: string;
}): Promise<PipelineMoveActionState> {
  try {
    const context = await getRepository();
    const receipt = await moveContactPipelineStageCommand(context.pipelineRepository, context.workspaceScope, input);
    revalidatePath('/pipeline'); revalidatePath('/insights'); revalidatePath(`/contacts/${input.contactId}`);
    return {
      ok: true,
      message: receipt.noOp ? 'Already in that stage.' : 'Pipeline stage saved.',
      contactId: receipt.contact.id,
      toStage: receipt.contact.pipelineStage,
      updatedAt: receipt.contact.updatedAt ?? receipt.contact.createdAt,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Pipeline move failed safely.' };
  }
}
