import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/** POST only — a GET sign-out can be triggered by any image tag or prefetch. */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);

  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  return NextResponse.redirect(`${origin}/login`, { status: 303 });
}
