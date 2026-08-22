'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { loadGoogleConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createGoogleOperationServerRepository } from '@/lib/data/google-operation-server-context';
import {
  prepareGoogleCalendarCreationIntent,
  prepareGoogleSyncIntent,
} from '@/lib/application/google-operations';
import { ConnectorError } from '@/lib/domain/connector';

function redirectWith(kind: 'success' | 'error', message: string): never {
  redirect(`/connections?${new URLSearchParams({ [kind]: message.slice(0, 180) }).toString()}`);
}

async function prepare(
  formData: FormData,
  operation: 'calendar-create' | 'gmail-sync' | 'calendar-sync',
) {
  let success = '';
  try {
    const connectionId = String(formData.get('connectionId') ?? '');
    const context = await getRepository();
    if (!context.isLive) throw new ConnectorError('forbidden', 'Sign in to a live workspace first.');
    const authenticated = await createSupabaseServerClient();
    const configuration = loadGoogleConfiguredRuntimeConfiguration();
    const operations = createGoogleOperationServerRepository({ authenticated });
    await (operation === 'calendar-create'
      ? await prepareGoogleCalendarCreationIntent(
          context.connectorRepository, operations, configuration, context.workspaceScope,
          { connectionId, correlationId: randomUUID() },
        )
      : await prepareGoogleSyncIntent(
          context.connectorRepository, operations, configuration, context.workspaceScope,
          {
            connectionId,
            actionType: operation === 'gmail-sync' ? 'gmail.sync-metadata' : 'calendar.sync',
            correlationId: randomUUID(),
          },
        ));
    revalidatePath('/connections');
    const suffix = context.workspaceScope.role === 'owner'
      ? ' Review and approve the exact operation below.'
      : ' The workspace owner must approve it before the worker calls Google.';
    success = `${operation === 'calendar-create' ? 'Calendar creation' : 'Bounded synchronization'} prepared.${suffix}`;
  } catch (error) {
    redirectWith('error', error instanceof ConnectorError ? error.message
      : 'The Google operation failed safely before calling the provider.');
  }
  redirectWith('success', success);
}

export async function prepareGoogleCalendarCreationAction(formData: FormData) {
  return prepare(formData, 'calendar-create');
}

export async function prepareGoogleGmailSyncAction(formData: FormData) {
  return prepare(formData, 'gmail-sync');
}

export async function prepareGoogleCalendarSyncAction(formData: FormData) {
  return prepare(formData, 'calendar-sync');
}
