'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isContactCommandError, recordConversationCommand } from '@/lib/application/contact-commands';
import type { ContactActionState } from '@/lib/application/contact-action-state';
import { parsePowerHourSession, powerHourHref } from '@/lib/application/power-hour-session';
import { getRepository } from '@/lib/data';

function values(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of formData.entries()) if (typeof entry === 'string') result[key] = entry;
  return result;
}

export async function completePowerHourStepAction(
  contactId: string,
  _state: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const session = parsePowerHourSession({
    done: String(formData.get('sessionDone') ?? '0'),
    skip: String(formData.get('sessionSkip') ?? ''),
  });
  try {
    const { repository, activityRepository, workspaceScope } = await getRepository();
    await recordConversationCommand(repository, contactId, formData, new Date(), {
      repository: activityRepository,
      scope: workspaceScope,
    });
  } catch (error) {
    if (!isContactCommandError(error)) console.error('[power-hour]', error);
    return {
      status: 'error',
      message: isContactCommandError(error) ? error.message : "We couldn't save that. Nothing was changed — try again.",
      ...(isContactCommandError(error) ? { fieldErrors: error.fieldErrors } : {}),
      values: values(formData),
    };
  }
  revalidatePath('/');
  revalidatePath('/contacts');
  revalidatePath(`/contacts/${contactId}`);
  redirect(powerHourHref({ ...session, done: session.done + 1 }));
}
