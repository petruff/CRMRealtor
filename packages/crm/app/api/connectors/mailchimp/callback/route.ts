import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveSupabaseWorkspaceScope } from '@/lib/data/supabase-workspace-scope';
import { selectedWorkspaceId } from '@/lib/data/selected-workspace';
import { createMailchimpOAuthServerRepository } from '@/lib/data/mailchimp-oauth-server-context';
import { completeMailchimpOAuth } from '@/lib/application/mailchimp-oauth-service';
import { loadMailchimpOAuthConfiguration } from '@/lib/providers/mailchimp-client';
import { loadMailchimpConfiguredRuntimeConfiguration } from '@/lib/config/connector-runtime';
import { safeInternalPath } from '@/lib/routing/route-policy';

export const dynamic = 'force-dynamic';

function redirectWithNotice(origin: string, path: string, kind: 'success' | 'error', value: string) {
  const url = new URL(safeInternalPath(path, '/connections'), origin);
  url.searchParams.set(kind, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete('omnix_mailchimp_oauth');
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const sessionSecret = (await cookies()).get('omnix_mailchimp_oauth')?.value;
  if (!code || !state || !sessionSecret) {
    return redirectWithNotice(url.origin, '/connections', 'error', 'mailchimp-oauth-invalid');
  }
  try {
    loadMailchimpConfiguredRuntimeConfiguration();
    const authenticated = await createSupabaseServerClient();
    const { data: { user } } = await authenticated.auth.getUser();
    if (!user) return redirectWithNotice(url.origin, '/connections', 'error', 'sign-in-required');
    const scope = await resolveSupabaseWorkspaceScope(authenticated, user.id, { selectedWorkspaceId: await selectedWorkspaceId() });
    const completed = await completeMailchimpOAuth({
      repository: createMailchimpOAuthServerRepository({ authenticated }),
      scope,
      actorUserId: user.id,
      sessionSecret,
      state,
      code,
      configuration: loadMailchimpOAuthConfiguration(),
    });
    return redirectWithNotice(
      url.origin,
      completed.safeReturnPath,
      'success',
      'mailchimp-connected-select-audience',
    );
  } catch {
    return redirectWithNotice(url.origin, '/connections', 'error', 'mailchimp-oauth-failed');
  }
}
