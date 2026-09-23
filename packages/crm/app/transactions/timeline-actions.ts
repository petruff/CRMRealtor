'use server';

import { revalidatePath } from 'next/cache';
import { createContractTimelineCommand } from '@/lib/application/contract-timeline-commands';
import { TimelineError, parseTimelineInput } from '@/lib/domain/florida-contract-timeline';
import { getRepository } from '@/lib/data';

export interface TimelineState {
  readonly status: 'idle' | 'saved' | 'error';
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
}

export async function createContractTimelineAction(transactionId: string, _state: TimelineState, formData: FormData): Promise<TimelineState> {
  try {
    const timeline = parseTimelineInput(formData);
    if (formData.get('confirmed') !== 'on') return { status: 'error', message: 'Check each date against the signed contract, then confirm.', fieldErrors: { confirmed: 'Required' } };
    const context = await getRepository();
    const deal = (await context.transactionRepository.list(context.workspaceScope)).find((row) => row.id === transactionId);
    if (!deal) return { status: 'error', message: 'This deal is no longer available.' };
    const result = await createContractTimelineCommand(context.operationalSignalRepository, context.workspaceScope, {
      transactionId, timeline, confirmed: true, timeZone: process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
    });
    revalidatePath('/transactions');
    revalidatePath('/inbox');
    revalidatePath('/');
    return {
      status: 'saved',
      message: result.created
        ? `${result.created} ${result.created === 1 ? 'date' : 'dates'} added to this deal${result.skipped ? ` · ${result.skipped} already there` : ''}. You’ll get a reminder 48 hours ahead.`
        : 'Every date was already on this deal.',
    };
  } catch (error) {
    if (error instanceof TimelineError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors };
    console.error('[contract-timeline]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'The timeline couldn’t be saved. Nothing was changed.' };
  }
}
