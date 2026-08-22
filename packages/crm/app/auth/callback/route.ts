import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { safeInternalPath } from '@/lib/routing/route-policy';

/**
 * OAuth return leg: exchange the one-time code for a session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeInternalPath(searchParams.get('next'));

  if (!isSupabaseConfigured() || !code) {
    return NextResponse.redirect(`${origin}/welcome?error=auth`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/welcome?error=auth`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
