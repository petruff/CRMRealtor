import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { createGoogleOAuthServerRepository } from '@/lib/data/google-oauth-server-context';
import { beginGoogleOAuth, createGoogleOAuthSessionSecret } from '@/lib/application/google-oauth-service';
import { loadGoogleOAuthConfiguration } from '@/lib/providers/google-client';
import { loadGoogleConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { parseGoogleFeatureBundle } from '@/lib/domain/google-connector';
import { randomUUID } from 'node:crypto';
import { recordConnectorOAuthRouteEvent } from '@/lib/observability/connector-oauth-route-telemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const correlationId = randomUUID();
  let stage = 'runtime-configuration';
  try {
    loadGoogleConfiguredRuntimeConfiguration();
    stage = 'request-validation';
    const bundle = parseGoogleFeatureBundle(url.searchParams.get('bundle') ?? 'workspace-core');
    const connectionId = url.searchParams.get('connectionId') ?? undefined;
    stage = 'authenticated-client';
    const authenticated = await createSupabaseServerClient();
    stage = 'authenticated-user';
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return NextResponse.redirect(`${url.origin}/welcome?next=%2Fconnections`);
    stage = 'workspace-scope';
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    const sessionSecret = createGoogleOAuthSessionSecret();
    stage = 'oauth-begin';
    const started = await beginGoogleOAuth({
      repository: createGoogleOAuthServerRepository({ authenticated }), scope,
      actorUserId: user.id, sessionSecret, safeReturnPath: '/connections', bundle,
      ...(connectionId ? { connectionId } : {}), configuration: loadGoogleOAuthConfiguration(),
    });
    const response = NextResponse.redirect(started.authorizationUrl);
    response.cookies.set('omnix_google_oauth', sessionSecret, {
      httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:',
      path: '/api/connectors/google', maxAge: 10 * 60,
    });
    recordConnectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-begin', stage: 'authorization-redirect',
      outcome: 'succeeded', correlationId,
    });
    return response;
  } catch (error) {
    recordConnectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-begin', stage,
      outcome: 'failed', correlationId, error,
    });
    return NextResponse.redirect(`${url.origin}/connections?error=google-configuration-required`);
  }
}
