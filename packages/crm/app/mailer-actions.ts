'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createMailerCampaignCommand,
  currentDateOnly,
  isMailerCommandError,
  MailerCommandError,
  markMailerSentCommand,
  unmarkMailerSentCommand,
} from '@/lib/application/mailer-commands';
import type { MailerActionState } from '@/lib/application/mailer-action-state';
import { getRepository } from '@/lib/data';

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ['name', 'notes']) {
    const value = formData.get(key);
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

function actionError(
  error: unknown,
  operation: string,
  values?: Record<string, string>,
): MailerActionState {
  if (isMailerCommandError(error)) {
    return { status: 'error', message: error.message, fieldErrors: error.fieldErrors, values };
  }
  if (error instanceof Error && ['Mailer campaign not found.', 'Contact not found.'].includes(error.message)) {
    return { status: 'error', message: error.message, values };
  }
  console.error(`[mailer-action:${operation}]`, error instanceof Error ? error.name : 'UnknownError');
  return {
    status: 'error',
    message: "We couldn't save that mailing change. Nothing was updated — please try again.",
    values,
  };
}

export async function createMailerAction(
  _state: MailerActionState,
  formData: FormData,
): Promise<MailerActionState> {
  const values = formValues(formData);
  let id: string;
  try {
    const { mailerRepository } = await getRepository();
    const campaign = await createMailerCampaignCommand(mailerRepository, formData);
    id = campaign.id;
  } catch (error) {
    return actionError(error, 'create', values);
  }
  revalidatePath('/mailers');
  redirect(`/mailers?campaign=${encodeURIComponent(id)}&saved=created`);
}

export async function toggleMailerSendAction(
  _state: MailerActionState,
  formData: FormData,
): Promise<MailerActionState> {
  const mailerId = formData.get('mailerId');
  const contactId = formData.get('contactId');
  const nextChecked = formData.get('nextChecked');
  try {
    if (nextChecked !== 'true' && nextChecked !== 'false') {
      throw new MailerCommandError('Mailer status is invalid.');
    }
    const { mailerRepository, repository } = await getRepository();
    if (nextChecked === 'true') {
      const send = await markMailerSentCommand(
        mailerRepository,
        repository,
        typeof mailerId === 'string' ? mailerId : '',
        typeof contactId === 'string' ? contactId : '',
        currentDateOnly(new Date(), process.env.OMNIX_TIME_ZONE ?? process.env.CRM_TIME_ZONE),
      );
      revalidatePath('/mailers');
      return { status: 'success', message: `Recorded as sent on ${send.sentOn}.` };
    }
    await unmarkMailerSentCommand(
      mailerRepository,
      typeof mailerId === 'string' ? mailerId : '',
      typeof contactId === 'string' ? contactId : '',
    );
    revalidatePath('/mailers');
    return { status: 'success', message: 'Send record cleared.' };
  } catch (error) {
    return actionError(error, 'toggle');
  }
}
