'use server';

import { revalidatePath } from 'next/cache';
import { transitionAttentionCommand } from '@/lib/application/attention-commands';
import { getRepository } from '@/lib/data';

export interface AttentionActionState {
  readonly status: 'idle' | 'success' | 'noop' | 'error';
  readonly message?: string;
}

export async function transitionAttentionAction(
  _state: AttentionActionState,
  formData: FormData,
): Promise<AttentionActionState> {
  const transition = formData.get('transition');
  if (transition !== 'acknowledge' && transition !== 'snooze' && transition !== 'complete') {
    return { status: 'error', message: 'Choose a valid attention action.' };
  }
  try {
    const { attentionRepository, workspaceScope } = await getRepository();
    const now = new Date();
    const result = await transitionAttentionCommand(
      attentionRepository,
      workspaceScope,
      formData.get('attentionId'),
      {
        transition,
        expectedVersion: formData.get('expectedVersion'),
        idempotencyKey: formData.get('idempotencyKey'),
        ...(transition === 'snooze'
          ? { snoozedUntil: new Date(now.getTime() + 86_400_000).toISOString() }
          : {}),
      },
      now,
    );
    revalidatePath('/');
    revalidatePath('/alerts');
    revalidatePath('/omnix');
    return {
      status: result.noOp ? 'noop' : 'success',
      message: result.noOp ? 'This priority was already updated.' : 'Priority updated.',
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'This priority could not be updated. Nothing changed.',
    };
  }
}
