import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

async function requestedScope(request: Request): Promise<'local' | 'global'> {
  try {
    const form = await request.formData();
    return form.get('scope') === 'global' ? 'global' : 'local';
  } catch {
    return 'local';
  }
}

/**
 * POST only — a GET sign-out can be triggered by any image tag or prefetch.
 * `scope=global` revokes every session of this account (lost phone, shared
 * computer); the default signs out only this browser.
 */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const scope = await requestedScope(request);

  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope });
  }

  return NextResponse.redirect(`${origin}/login${scope === 'global' ? '?signedOut=all' : ''}`, { status: 303 });
}
