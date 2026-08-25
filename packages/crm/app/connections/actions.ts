'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  approveConnectorIntentCommand,
  cancelConnectorJobCommand,
  disconnectConnectorCommand,
  editConnectorIntentCommand,
  rejectConnectorIntentCommand,
  retryConnectorJobCommand,
} from '@/lib/application/connector-commands';
import { ConnectorError } from '@/lib/domain/connector';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseTwilioOperationRepository } from '@/lib/data/twilio-operation-repository';
import { approveTextingIntentCommand, disableTextingCommand } from '@/lib/application/texting-commands';
import { configureTwilioConnection } from '@/lib/application/twilio-setup-service';
import { discoverAndStageMetaAssets, selectAndSubscribeMetaAssets } from '@/lib/application/meta-asset-setup-service';
import { loadMetaOAuthConfiguration } from '@/lib/providers/meta-client';
import { supabaseMetaOperationRepository } from '@/lib/data/meta-operation-repository';
import { createClient } from '@supabase/supabase-js';

function value(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function resultRedirect(kind: 'success' | 'error', message: string): never {
  const query = new URLSearchParams({ [kind]: message });
  redirect(`/connections?${query.toString()}`);
}

async function liveContext() {
  const context = await getRepository();
  if (!context.isLive) throw new ConnectorError('forbidden', 'Sign in to manage live connections.');
  return context;
}

async function action(
  operation: () => Promise<unknown>,
  success: string,
): Promise<never> {
  try {
    await operation();
    revalidatePath('/connections');
  } catch (error) {
    const message = error instanceof ConnectorError
      ? error.message
      : 'The connection could not be updated. Nothing unsafe was changed; try again.';
    resultRedirect('error', message.slice(0, 180));
  }
  resultRedirect('success', success);
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new ConnectorError('configuration-required', 'Connector service authority is missing.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function disconnectConnectionAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await disconnectConnectorCommand(context.connectorRepository, context.workspaceScope, {
      connectionId: value(formData, 'connectionId'),
      correlationId: randomUUID(),
    });
  }, 'The account is disconnecting. Your CRM history will remain available.');
}

export async function approveConnectorIntentAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await approveConnectorIntentCommand(context.connectorRepository, context.workspaceScope, {
      intentId: value(formData, 'intentId'),
      expectedVersion: value(formData, 'expectedVersion'),
      idempotencyKey: `ui-approve:${randomUUID()}`,
      correlationId: randomUUID(),
    });
  }, 'Approved. Omnix will complete this action once.');
}

export async function approveTextingIntentAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await approveTextingIntentCommand(
      supabaseTwilioOperationRepository(await createSupabaseServerClient()),
      context.workspaceScope,
      {
        intentId: value(formData, 'intentId'),
        intentVersion: value(formData, 'expectedVersion'),
        payloadHash: value(formData, 'payloadHash'),
      },
    );
  }, 'Text approved. Omnix confirmed the contact’s permission and quiet hours before scheduling it.');
}

export async function disableTextingAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await disableTextingCommand(
      supabaseTwilioOperationRepository(await createSupabaseServerClient()),
      context.workspaceScope,
      {
        connectionId: value(formData, 'connectionId'),
        destroySendCredentials: value(formData, 'destroySendCredentials') === 'true',
      },
    );
  }, 'Business texting was disconnected and waiting messages were cancelled.');
}

export async function configureTwilioAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    if (context.workspaceScope.role !== 'owner') throw new ConnectorError('forbidden', 'Owner authority is required.');
    const authenticated = await createSupabaseServerClient();
    await configureTwilioConnection({
      authenticated,
      service: serviceClient(),
      scope: context.workspaceScope,
      connectionId: value(formData, 'connectionId'),
    });
  }, 'The business texting account was verified. Send one final delivery test to finish setup.');
}

export async function discoverMetaAssetsAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await discoverAndStageMetaAssets({
      service: serviceClient(), scope: context.workspaceScope,
      connectionId: value(formData, 'connectionId') ?? '',
      configuration: loadMetaOAuthConfiguration(),
    });
  }, 'Eligible Meta business assets were verified. Select only the assets Omnix may receive from.');
}

export async function selectMetaAssetsAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    const assetHashes = formData.getAll('assetHash').filter((item): item is string => typeof item === 'string' && Boolean(item));
    if (!assetHashes.length) throw new ConnectorError('invalid-input', 'Select at least one eligible business asset.');
    await selectAndSubscribeMetaAssets({
      authenticated: await createSupabaseServerClient(), service: serviceClient(), scope: context.workspaceScope,
      connectionId: value(formData, 'connectionId') ?? '', snapshotHash: value(formData, 'snapshotHash') ?? '',
      assetHashes, configuration: loadMetaOAuthConfiguration(),
    });
  }, 'The selected business accounts were saved. Meta must finish its connection check before new enquiries arrive.');
}

export async function resolveMetaReviewAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await supabaseMetaOperationRepository(await createSupabaseServerClient()).resolveReview(context.workspaceScope, {
      eventId: value(formData, 'eventId') ?? '', contactId: value(formData, 'contactId') ?? '',
      correlationId: randomUUID(),
    });
  }, 'The social media enquiry was linked to the selected contact.');
}

export async function rejectConnectorIntentAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await rejectConnectorIntentCommand(context.connectorRepository, context.workspaceScope, {
      intentId: value(formData, 'intentId'),
      expectedVersion: value(formData, 'expectedVersion'),
      correlationId: randomUUID(),
    });
  }, 'The pending action was rejected. Nothing was sent or changed.');
}

export async function editConnectorIntentAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await editConnectorIntentCommand(context.connectorRepository, context.workspaceScope, {
      intentId: value(formData, 'intentId'),
      expectedVersion: value(formData, 'expectedVersion'),
      payloadReference: value(formData, 'payloadReference'),
      payloadHash: value(formData, 'payloadHash'),
      policyId: value(formData, 'policyId'),
      policyVersion: value(formData, 'policyVersion'),
      summary: value(formData, 'summary'),
      complianceSnapshot: {},
      correlationId: randomUUID(),
    });
  }, 'A new version was created and requires approval.');
}

export async function retryConnectorJobAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await retryConnectorJobCommand(
      context.connectorRepository,
      context.workspaceScope,
      value(formData, 'jobId'),
    );
  }, 'Eligible job queued for retry.');
}

export async function cancelConnectorJobAction(formData: FormData) {
  return action(async () => {
    const context = await liveContext();
    await cancelConnectorJobCommand(
      context.connectorRepository,
      context.workspaceScope,
      value(formData, 'jobId'),
    );
  }, 'Eligible job cancelled.');
}
