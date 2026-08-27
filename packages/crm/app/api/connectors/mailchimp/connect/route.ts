import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { createMailchimpOAuthServerRepository } from '@/lib/data/mailchimp-oauth-server-context';
import { beginMailchimpOAuth, createMailchimpOAuthSessionSecret } from '@/lib/application/mailchimp-oauth-service';
import { loadMailchimpOAuthConfiguration } from '@/lib/providers/mailchimp-client';
import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { randomUUID } from 'node:crypto';
import { recordConnectorOAuthRouteEvent } from '@/lib/observability/connector-oauth-route-telemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const correlationId = randomUUID();
  let stage = 'runtime-configuration';
  try {
    loadMailchimpConfiguredRuntimeConfiguration();
    stage = 'authenticated-client';
    const authenticated = await createSupabaseServerClient();
    stage = 'authenticated-user';
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return NextResponse.redirect(`${origin}/welcome?next=%2Fconnections`);
    stage = 'workspace-scope';
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    const sessionSecret = createMailchimpOAuthSessionSecret();
    const connectionId = requestUrl.searchParams.get('connectionId') ?? undefined;
    stage = 'oauth-begin';
    const started = await beginMailchimpOAuth({
      repository: createMailchimpOAuthServerRepository({ authenticated }),
      scope,
      actorUserId: user.id,
      sessionSecret,
      safeReturnPath: '/connections',
      ...(connectionId ? { connectionId } : {}),
      configuration: loadMailchimpOAuthConfiguration(),
    });
    stage = 'authorization-redirect';
    const response = NextResponse.redirect(started.authorizationUrl);
    response.cookies.set('omnix_mailchimp_oauth', sessionSecret, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/api/connectors/mailchimp',
      maxAge: 15 * 60,
    });
    recordConnectorOAuthRouteEvent({
      provider: 'mailchimp', operation: 'oauth-begin', stage,
      outcome: 'succeeded', correlationId,
    });
    return response;
  } catch (error) {
    recordConnectorOAuthRouteEvent({
      provider: 'mailchimp', operation: 'oauth-begin', stage,
      outcome: 'failed', correlationId, error,
    });
    return NextResponse.redirect(`${origin}/connections?error=mailchimp-configuration-required`);
  }
}
