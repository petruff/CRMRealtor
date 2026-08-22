import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { completeMetaOAuth } from '@/lib/application/meta-oauth-service';
import { loadMetaConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMetaOAuthServerRepository } from '@/lib/data/meta-oauth-server-context';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { loadMetaOAuthConfiguration } from '@/lib/providers/meta-client';
import { safeInternalPath } from '@/lib/routing/route-policy';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
function destination(origin: string, path: string, kind: 'success' | 'error', value: string) {
  const url = new URL(safeInternalPath(path, '/connections'), origin);
  url.searchParams.set(kind, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete('omnix_meta_oauth');
  return response;
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const sessionSecret = (await cookies()).get('omnix_meta_oauth')?.value;
  if (!code || !state || !sessionSecret) return destination(url.origin, '/connections', 'error', 'meta-oauth-invalid');
  try {
    loadMetaConfiguredRuntimeConfiguration();
    const authenticated = await createSupabaseServerClient();
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return destination(url.origin, '/connections', 'error', 'sign-in-required');
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    const completed = await completeMetaOAuth({
      repository: createMetaOAuthServerRepository({ authenticated }), scope, actorUserId: user.id,
      sessionSecret, state, code, configuration: loadMetaOAuthConfiguration(),
    });
    return destination(url.origin, completed.safeReturnPath, 'success', `meta-${completed.loginMode}-authorized`);
  } catch {
    return destination(url.origin, '/connections', 'error', 'meta-oauth-failed');
  }
}
