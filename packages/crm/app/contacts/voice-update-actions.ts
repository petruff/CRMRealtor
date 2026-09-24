'use server';

import { revalidatePath } from 'next/cache';
import { getRepository } from '@/lib/data';
import { applyVoiceUpdate, reviewVoiceUpdate, VoiceUpdateError, type VoiceUpdateReview } from '@/lib/application/voice-update-commands';

function today(): string {
  const timeZone = process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export type VoiceReviewResult = { readonly status: 'ok'; readonly review: VoiceUpdateReview } | { readonly status: 'error'; readonly message: string };
export type VoiceApplyResult = { readonly status: 'saved' | 'error'; readonly message: string };

/** Read-only preview of what a spoken update would change. */
export async function reviewVoiceUpdateAction(contactId: unknown, text: unknown): Promise<VoiceReviewResult> {
  try {
    const { repository } = await getRepository();
    return { status: 'ok', review: await reviewVoiceUpdate(repository, contactId, text, today()) };
  } catch (error) {
    if (error instanceof VoiceUpdateError) return { status: 'error', message: error.message };
    console.error('[voice-update:review]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'That update couldn’t be read. Nothing was changed.' };
  }
}

/** Saves the changes the realtor kept. */
export async function applyVoiceUpdateAction(input: unknown): Promise<VoiceApplyResult> {
  try {
    const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const result = await applyVoiceUpdate({
      repository,
      ...(activityRepository ? { activity: { repository: activityRepository, scope: workspaceScope } } : {}),
      contactId: value.contactId, text: value.text, keep: value.keep, saveNote: value.saveNote, today: today(),
    });
    if (typeof value.contactId === 'string') revalidatePath(`/contacts/${value.contactId}`);
    revalidatePath('/');
    return { status: 'saved', message: result.message };
  } catch (error) {
    if (error instanceof VoiceUpdateError) return { status: 'error', message: error.message };
    console.error('[voice-update:apply]', error instanceof Error ? error.name : 'unknown');
    return { status: 'error', message: 'That update couldn’t be saved. Nothing was changed.' };
  }
}
