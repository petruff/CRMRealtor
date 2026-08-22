'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createMailchimpOperationServerRepository, createMailchimpServerRepository } from '@/lib/data/mailchimp-operation-server-context';
import {
  listLiveMailchimpAudiencesCommand,
  persistMailchimpAudienceSelectionCommand,
  probeLiveMailchimpConnectionCommand,
  setupMailchimpSignedWebhookCommand,
} from '@/lib/application/mailchimp-commands';
import { requestMailchimpReconciliationCommand } from '@/lib/application/mailchimp-reconciliation-service';
import {
  approveMailchimpOutboundBackfillCommand,
  previewMailchimpOutboundBackfillCommand,
} from '@/lib/application/mailchimp-outbound-backfill-service';
import { MailchimpMarketingClient } from '@/lib/providers/mailchimp-client';
import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { ConnectorError } from '@/lib/domain/connector';

function field(formData: FormData, name: string): string | undefined {
  const raw = formData.get(name);
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function notice(kind: 'success' | 'error', value: string): never {
  revalidatePath('/connections');
  redirect(`/connections?${new URLSearchParams({ [kind]: value })}`);
}

export async function selectMailchimpAudienceAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const connectionId = field(formData, 'connectionId');
    const audienceId = field(formData, 'audienceId');
    if (!connectionId || !audienceId) throw new ConnectorError('invalid-input', 'Choose a Mailchimp audience.');
    const authenticated = await createSupabaseServerClient();
    const operations = createMailchimpOperationServerRepository({ authenticated });
    const configuration = loadMailchimpConfiguredRuntimeConfiguration();
    const audiences = await listLiveMailchimpAudiencesCommand(
      operations, configuration, context.workspaceScope,
      { connectionId, limit: 500 },
      { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
    );
    const audience = audiences.find((candidate) => candidate.id === audienceId);
    if (!audience) throw new ConnectorError('not-found', 'Mailchimp audience was not found in this account.');
    await persistMailchimpAudienceSelectionCommand(
      operations, configuration, context.workspaceScope,
      { connectionId, audience, correlationId: randomUUID() },
    );
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Mailchimp audience selection failed safely.';
    notice('error', message.slice(0, 160));
  }
  notice('success', 'Mailchimp audience selected. Baseline and signed webhook proof are still required.');
}

export async function setupMailchimpWebhookAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const connectionId = field(formData, 'connectionId');
    if (!connectionId) throw new ConnectorError('invalid-input', 'Mailchimp connection is required.');
    const authenticated = await createSupabaseServerClient();
    const operations = createMailchimpOperationServerRepository({ authenticated });
    await setupMailchimpSignedWebhookCommand(
      operations, loadMailchimpConfiguredRuntimeConfiguration(), context.workspaceScope,
      {
        connectionId,
        webhookBaseUrl: process.env.MAILCHIMP_WEBHOOK_BASE_URL ?? '',
        correlationId: randomUUID(),
      },
      { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
    );
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Signed Mailchimp webhook setup failed safely.';
    notice('error', message.slice(0, 160));
  }
  notice('success', 'Signed Mailchimp webhook verified and isolated to this audience.');
}

export async function reconcileMailchimpBaselineAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const connectionId = field(formData, 'connectionId');
    if (!connectionId) throw new ConnectorError('invalid-input', 'Mailchimp connection is required.');
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    await requestMailchimpReconciliationCommand(
      server.operations,
      server.reconciliations,
      context.workspaceScope,
      { connectionId, pageSize: 100, correlationId: randomUUID() },
    );
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Mailchimp baseline reconciliation failed safely.';
    notice('error', message.slice(0, 160));
  }
  notice('success', 'Mailchimp reconciliation queued. Progress and review outcomes remain visible.');
}

export async function finishMailchimpSetupAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const connectionId = field(formData, 'connectionId');
    if (!connectionId) throw new ConnectorError('invalid-input', 'Mailchimp connection is required.');
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    const binding = await server.operations.getSelectedAudience(context.workspaceScope, connectionId);
    if (!binding) throw new ConnectorError('not-found', 'Choose a Mailchimp audience first.');
    if (binding.webhookRegistrationRequired) {
      await setupMailchimpSignedWebhookCommand(
        server.operations, loadMailchimpConfiguredRuntimeConfiguration(), context.workspaceScope,
        {
          connectionId,
          webhookBaseUrl: process.env.MAILCHIMP_WEBHOOK_BASE_URL ?? '',
          correlationId: randomUUID(),
        },
        { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
      );
    }
    if (binding.baselineRequired) {
      await requestMailchimpReconciliationCommand(
        server.operations,
        server.reconciliations,
        context.workspaceScope,
        { connectionId, pageSize: 100, correlationId: randomUUID() },
      );
    }
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Mailchimp setup could not be completed safely.';
    notice('error', message.slice(0, 160));
  }
  notice('success', 'Mailchimp setup is finishing. Contact matching and subscription updates are being prepared.');
}

export async function probeMailchimpConnectionAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const connectionId = field(formData, 'connectionId');
    if (!connectionId) throw new ConnectorError('invalid-input', 'Mailchimp connection is required.');
    const authenticated = await createSupabaseServerClient();
    const operations = createMailchimpOperationServerRepository({ authenticated });
    const result = await probeLiveMailchimpConnectionCommand(
      operations,
      loadMailchimpConfiguredRuntimeConfiguration(),
      context.workspaceScope,
      { connectionId, correlationId: randomUUID() },
      { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
    );
    if (!result.healthy) notice('error', `Mailchimp probe completed: ${result.status}.`);
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Mailchimp probe failed safely.';
    notice('error', message.slice(0, 160));
  }
  notice('success', 'Mailchimp responded and a redacted probe receipt was saved.');
}

export async function previewMailchimpBackfillAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const connectionId = field(formData, 'connectionId');
    if (!connectionId) throw new ConnectorError('invalid-input', 'Mailchimp connection is required.');
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    const result = await previewMailchimpOutboundBackfillCommand(
      server.outboundBackfills,
      loadMailchimpConfiguredRuntimeConfiguration(),
      context.workspaceScope,
      { connectionId, mode: 'backfill', pageSize: 100, correlationId: randomUUID() },
    );
    notice(
      'success',
      `Preview ready: ${result.eligibleCount} eligible, ${result.skippedUnlinkedCount} unlinked and ${result.skippedUnsubscribedCount} unsubscribed. Review and approve the exact snapshot below.`,
    );
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Mailchimp backfill preview failed safely.';
    notice('error', message.slice(0, 200));
  }
}

export async function approveMailchimpBackfillAction(formData: FormData) {
  try {
    const context = await getRepository();
    if (!context.isLive || context.workspaceScope.role !== 'owner') {
      throw new ConnectorError('forbidden', 'Sign in as the workspace owner.');
    }
    const runId = field(formData, 'runId');
    const snapshotHash = field(formData, 'snapshotHash');
    const mappingVersion = Number(field(formData, 'mappingVersion'));
    if (!runId || !snapshotHash || !Number.isInteger(mappingVersion)) {
      throw new ConnectorError('invalid-input', 'Mailchimp backfill approval is incomplete.');
    }
    const authenticated = await createSupabaseServerClient();
    const server = createMailchimpServerRepository({ authenticated });
    await approveMailchimpOutboundBackfillCommand(
      server.outboundBackfills,
      loadMailchimpConfiguredRuntimeConfiguration(),
      context.workspaceScope,
      { runId, snapshotHash, mappingVersion, correlationId: randomUUID() },
    );
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : 'Mailchimp backfill approval failed safely.';
    notice('error', message.slice(0, 180));
  }
  notice('success', 'Exact Mailchimp backfill snapshot approved. Durable jobs will be created in bounded batches.');
}
