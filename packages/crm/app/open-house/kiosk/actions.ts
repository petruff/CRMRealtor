'use server';

import { revalidatePath } from 'next/cache';
import { signInOpenHouseVisitorCommand } from '@/lib/application/open-house-commands';
import { OpenHouseError } from '@/lib/domain/open-house';
import { getRepository } from '@/lib/data';

export interface OpenHouseSignInState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
  readonly firstName?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly values?: Readonly<Record<string, string>>;
  /** Changes on every success so the form remounts empty for the next guest. */
  readonly submissionKey?: string;
}

export async function openHouseSignInAction(
  property: string,
  _state: OpenHouseSignInState,
  formData: FormData,
): Promise<OpenHouseSignInState> {
  // Honeypot: real visitors never see or fill this field.
  if (String(formData.get('website') ?? '')) return { status: 'success', firstName: 'friend', submissionKey: String(Date.now()) };
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    const result = await signInOpenHouseVisitorCommand(repository, {
      property,
      form: formData,
      timeZone: process.env.OMNIX_TIME_ZONE?.trim() || 'America/New_York',
    }, new Date(), { repository: activityRepository, scope: workspaceScope });
    revalidatePath('/');
    revalidatePath('/open-house');
    revalidatePath('/contacts');
    return { status: 'success', firstName: result.firstName, submissionKey: `${result.contactId}:${Date.now()}` };
  } catch (error) {
    const values: Record<string, string> = {};
    for (const [key, entry] of formData.entries()) if (typeof entry === 'string' && key !== 'website') values[key] = entry;
    if (error instanceof OpenHouseError) return { status: 'error', message: error.message, fieldErrors: error.fieldErrors, values };
    console.error('[open-house-sign-in]', error instanceof Error ? error.message : 'unknown');
    return { status: 'error', message: 'Sorry — that didn’t save. Please try again or tell the agent.', values };
  }
}
