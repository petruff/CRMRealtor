'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getRepository } from '@/lib/data';
import { supabaseTwilioOperationRepository } from '@/lib/data/twilio-operation-repository';
import { ConnectorError } from '@/lib/domain/connector';
import { prepareTextingMessageCommand, recordTextingConsentCommand } from '@/lib/application/texting-commands';
import { supabaseContactOutboundGuard } from '@/lib/data/supabase-contact-outbound-guard';
import type { TextingActionState } from '@/app/contacts/action-state';

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '');
}

async function context() {
  const repository = await getRepository();
  if (!repository.isLive) throw new ConnectorError('forbidden', 'Sign in to a live workspace before provider texting.');
  return {
    repository: supabaseTwilioOperationRepository(await createSupabaseServerClient()),
    scope: repository.workspaceScope,
  };
}

function failure(error: unknown): TextingActionState {
  return { status: 'error', message: error instanceof ConnectorError
    ? error.message : 'The texting operation failed safely before calling the provider.' };
}

export async function prepareTextingMessageAction(
  _previous: TextingActionState,
  formData: FormData,
): Promise<TextingActionState> {
  const contactId = value(formData, 'contactId');
  try {
    const live = await context();
    const client = await createSupabaseServerClient();
    await prepareTextingMessageCommand(live.repository, live.scope, {
      connectionId: value(formData, 'connectionId'), contactId,
      contactPointId: value(formData, 'contactPointId'), recipientPhone: value(formData, 'recipientPhone'),
      useCase: value(formData, 'useCase'), body: value(formData, 'body'),
    }, supabaseContactOutboundGuard(client));
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/connections');
    return { status: 'success', message: 'Draft prepared. Nothing sends until the owner approves the exact text.' };
  } catch (error) { return failure(error); }
}

export async function recordTextingConsentAction(
  _previous: TextingActionState,
  formData: FormData,
): Promise<TextingActionState> {
  const contactId = value(formData, 'contactId');
  try {
    const live = await context();
    await recordTextingConsentCommand(live.repository, live.scope, {
      connectionId: value(formData, 'connectionId'), contactId,
      contactPointId: value(formData, 'contactPointId'), useCase: value(formData, 'useCase'),
      status: value(formData, 'status'), collectionMethod: value(formData, 'collectionMethod'),
      disclosureVersion: value(formData, 'disclosureVersion'), evidenceReference: value(formData, 'evidenceReference'),
      recipientTimeZone: value(formData, 'recipientTimeZone'), timezoneSource: value(formData, 'timezoneSource'),
    });
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/connections');
    return { status: 'success', message: 'Consent evidence recorded. Historical opt-outs remain preserved.' };
  } catch (error) { return failure(error); }
}

export async function requestTextingUatAction(
  _previous: TextingActionState,
  formData: FormData,
): Promise<TextingActionState> {
  const contactId = value(formData, 'contactId');
  try {
    const live = await context();
    const result = await live.repository.requestRealNumberUat(live.scope, {
      connectionId: value(formData, 'connectionId'), contactId,
      contactPointId: value(formData, 'contactPointId'), recipientPhone: value(formData, 'recipientPhone'),
      body: value(formData, 'body'), recipientTimeZone: value(formData, 'recipientTimeZone') || undefined,
      timezoneSource: value(formData, 'timezoneSource') || undefined, occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/connections');
    return { status: 'success', message: result.noOp
      ? 'This exact real-number UAT is already queued.'
      : 'Real-number UAT queued. Ordinary provider texting stays blocked until Twilio confirms final delivery.' };
  } catch (error) { return failure(error); }
}
