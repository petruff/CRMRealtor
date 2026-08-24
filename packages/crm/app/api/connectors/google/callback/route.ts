import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { createGoogleOAuthServerRepository } from '@/lib/data/google-oauth-server-context';
import { completeGoogleOAuth } from '@/lib/application/google-oauth-service';
import { loadGoogleOAuthConfiguration } from '@/lib/providers/google-client';
import { loadGoogleConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { safeInternalPath } from '@/lib/routing/route-policy';
import { randomUUID } from 'node:crypto';
import { recordConnectorOAuthRouteEvent } from '@/lib/observability/connector-oauth-route-telemetry';

export const dynamic = 'force-dynamic';

function redirectWithNotice(origin: string, path: string, kind: 'success' | 'error', value: string) {
  const url = new URL(safeInternalPath(path, '/connections'), origin);
  url.searchParams.set(kind, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete('omnix_google_oauth');
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const correlationId = randomUUID();
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const sessionSecret = (await cookies()).get('omnix_google_oauth')?.value;
  if (providerError) {
    recordConnectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-callback', stage: 'provider-consent',
      outcome: 'denied', correlationId,
    });
    return redirectWithNotice(url.origin, '/connections', 'error', 'google-oauth-denied');
  }
  if (!code || !state || !sessionSecret) {
    recordConnectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-callback', stage: 'browser-transaction',
      outcome: 'failed', correlationId,
    });
    return redirectWithNotice(url.origin, '/connections', 'error', 'google-oauth-invalid');
  }
  let stage = 'runtime-configuration';
  try {
    loadGoogleConfiguredRuntimeConfiguration();
    stage = 'authenticated-client';
    const authenticated = await createSupabaseServerClient();
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return redirectWithNotice(url.origin, '/connections', 'error', 'sign-in-required');
    stage = 'workspace-scope';
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    stage = 'oauth-completion';
    const completed = await completeGoogleOAuth({
      repository: createGoogleOAuthServerRepository({ authenticated }), scope,
      actorUserId: user.id, sessionSecret, state, code, configuration: loadGoogleOAuthConfiguration(),
    });
    const partial = completed.bundle === 'workspace-core' && completed.missingScopes.length > 0;
    recordConnectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-callback', stage: partial ? 'partial-consent' : 'completed',
      outcome: 'succeeded', correlationId,
    });
    return redirectWithNotice(
      url.origin,
      completed.safeReturnPath,
      'success',
      partial ? 'google-workspace-core-partial' : `google-${completed.bundle}-connected`,
    );
  } catch (error) {
    recordConnectorOAuthRouteEvent({
      provider: 'google', operation: 'oauth-callback', stage,
      outcome: 'failed', correlationId, error,
    });
    return redirectWithNotice(url.origin, '/connections', 'error', 'google-oauth-failed');
  }
}
