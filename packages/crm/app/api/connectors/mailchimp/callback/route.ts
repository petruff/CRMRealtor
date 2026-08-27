import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { createMailchimpOAuthServerRepository } from '@/lib/data/mailchimp-oauth-server-context';
import { completeMailchimpOAuth } from '@/lib/application/mailchimp-oauth-service';
import { resumeMailchimpGuidedSetup } from '@/lib/application/mailchimp-guided-setup-service';
import {
  listLiveMailchimpAudiencesCommand,
  persistMailchimpAudienceSelectionCommand,
  setupMailchimpSignedWebhookCommand,
} from '@/lib/application/mailchimp-commands';
import { requestAndDrainMailchimpReconciliationCommand } from '@/lib/application/mailchimp-reconciliation-service';
import { loadMailchimpOAuthConfiguration, MailchimpMarketingClient } from '@/lib/providers/mailchimp-client';
import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMailchimpServerRepository } from '@/lib/data/mailchimp-operation-server-context';
import { ConnectorError } from '@/lib/domain/connector';
import { safeInternalPath } from '@/lib/routing/route-policy';
import { randomUUID } from 'node:crypto';
import { recordConnectorOAuthRouteEvent } from '@/lib/observability/connector-oauth-route-telemetry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function redirectWithNotice(origin: string, path: string, kind: 'success' | 'error', value: string) {
  const url = new URL(safeInternalPath(path, '/connections'), origin);
  url.searchParams.set(kind, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete('omnix_mailchimp_oauth');
  return response;
}

function guidedSetupErrorNotice(error: unknown): string {
  if (!(error instanceof ConnectorError)) return 'mailchimp-setup-failed';
  if (error.code === 'configuration-required') return 'mailchimp-setup-developer';
  if (error.code === 'forbidden') return 'mailchimp-setup-reconnect';
  if (error.code === 'provider-retryable') return 'mailchimp-setup-temporary';
  if (error.code === 'not-found') return 'mailchimp-audience-required';
  return 'mailchimp-setup-failed';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const correlationId = randomUUID();
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const sessionSecret = (await cookies()).get('omnix_mailchimp_oauth')?.value;
  if (providerError) {
    recordConnectorOAuthRouteEvent({
      provider: 'mailchimp', operation: 'oauth-callback', stage: 'provider-consent',
      outcome: 'denied', correlationId,
    });
    return redirectWithNotice(url.origin, '/connections', 'error', 'mailchimp-oauth-denied');
  }
  if (!code || !state || !sessionSecret) {
    recordConnectorOAuthRouteEvent({
      provider: 'mailchimp', operation: 'oauth-callback', stage: 'browser-transaction',
      outcome: 'failed', correlationId,
    });
    return redirectWithNotice(url.origin, '/connections', 'error', 'mailchimp-oauth-invalid');
  }
  let stage = 'runtime-configuration';
  try {
    const runtimeConfiguration = loadMailchimpConfiguredRuntimeConfiguration();
    stage = 'authenticated-client';
    const authenticated = await createSupabaseServerClient();
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return redirectWithNotice(url.origin, '/connections', 'error', 'sign-in-required');
    stage = 'workspace-scope';
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    stage = 'oauth-completion';
    const completed = await completeMailchimpOAuth({
      repository: createMailchimpOAuthServerRepository({ authenticated }),
      scope,
      actorUserId: user.id,
      sessionSecret,
      state,
      code,
      configuration: loadMailchimpOAuthConfiguration(),
    });
    stage = 'guided-setup';
    const server = createMailchimpServerRepository({ authenticated });
    let setup: Awaited<ReturnType<typeof resumeMailchimpGuidedSetup>>;
    try {
      setup = await resumeMailchimpGuidedSetup({
        getSelectedAudience: () => server.operations.getSelectedAudience(scope, completed.connectionId),
        listAudiences: () => listLiveMailchimpAudiencesCommand(
          server.operations,
          runtimeConfiguration,
          scope,
          { connectionId: completed.connectionId, limit: 500 },
          { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
        ),
        selectAudience: async (audience) => (await persistMailchimpAudienceSelectionCommand(
          server.operations,
          runtimeConfiguration,
          scope,
          { connectionId: completed.connectionId, audience, correlationId: randomUUID() },
        )).binding,
        setupWebhook: async () => {
          await setupMailchimpSignedWebhookCommand(
            server.operations,
            runtimeConfiguration,
            scope,
            {
              connectionId: completed.connectionId,
              webhookBaseUrl: process.env.MAILCHIMP_WEBHOOK_BASE_URL ?? '',
              correlationId: randomUUID(),
            },
            { createClient: (dataCenter, token) => new MailchimpMarketingClient(dataCenter, token) },
          );
        },
        reconcileBaseline: async () => {
          const progress = await requestAndDrainMailchimpReconciliationCommand(
            server.operations,
            server.reconciliations,
            runtimeConfiguration,
            scope,
            { connectionId: completed.connectionId, pageSize: 100, correlationId: randomUUID() },
          );
          return {
            completed: progress.targetRun.state === 'succeeded',
            review: progress.targetRun.state === 'review',
          };
        },
      });
    } catch (error) {
      recordConnectorOAuthRouteEvent({
        provider: 'mailchimp', operation: 'oauth-callback', stage,
        outcome: 'failed', correlationId, error,
      });
      return redirectWithNotice(
        url.origin,
        completed.safeReturnPath,
        'error',
        guidedSetupErrorNotice(error),
      );
    }
    recordConnectorOAuthRouteEvent({
      provider: 'mailchimp', operation: 'oauth-callback', stage: 'completed',
      outcome: 'succeeded', correlationId,
    });
    return redirectWithNotice(
      url.origin,
      completed.safeReturnPath,
      setup.state === 'review' ? 'error' : 'success',
      setup.state === 'selection-required'
        ? 'mailchimp-connected-select-audience'
        : setup.state === 'syncing'
          ? 'mailchimp-setup-syncing'
          : setup.state === 'review'
            ? 'mailchimp-setup-review'
            : 'mailchimp-setup-complete',
    );
  } catch (error) {
    recordConnectorOAuthRouteEvent({
      provider: 'mailchimp', operation: 'oauth-callback', stage,
      outcome: 'failed', correlationId, error,
    });
    return redirectWithNotice(url.origin, '/connections', 'error', 'mailchimp-oauth-failed');
  }
}
