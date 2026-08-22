import { NextResponse } from 'next/server';
import { beginMetaOAuth, createMetaOAuthSessionSecret } from '@/lib/application/meta-oauth-service';
import { loadMetaConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { createMetaOAuthServerRepository } from '@/lib/data/meta-oauth-server-context';
import type { MetaLoginMode } from '@/lib/data/meta-oauth-repository';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { loadMetaOAuthConfiguration } from '@/lib/providers/meta-client';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    loadMetaConfiguredRuntimeConfiguration();
    const loginMode = url.searchParams.get('loginMode') as MetaLoginMode;
    if (!['facebook-page', 'instagram-login'].includes(loginMode)) throw new Error('invalid mode');
    const authenticated = await createSupabaseServerClient();
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return NextResponse.redirect(`${url.origin}/welcome?next=%2Fconnections`);
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    const sessionSecret = createMetaOAuthSessionSecret();
    const started = await beginMetaOAuth({
      repository: createMetaOAuthServerRepository({ authenticated }), scope, actorUserId: user.id,
      sessionSecret, loginMode, safeReturnPath: '/connections',
      connectionId: url.searchParams.get('connectionId') ?? undefined,
      configuration: loadMetaOAuthConfiguration(),
    });
    const response = NextResponse.redirect(started.authorizationUrl);
    response.cookies.set('omnix_meta_oauth', sessionSecret, {
      httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:',
      path: '/api/connectors/meta', maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(`${url.origin}/connections?error=meta-configuration-required`);
  }
}
