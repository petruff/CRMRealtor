import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers.js';
import { requireSupabaseEnv } from './env.ts';

/**
 * Server-side Supabase client, cookie-backed so the session survives navigation.
 *
 * Must be created per request — never hoisted to a module-level singleton, or one
 * visitor's session leaks into another's request.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session instead, so this is safe to swallow here.
        }
      },
    },
  });
}

/** The signed-in user, or null. Never throws when unconfigured. */
export async function getCurrentUser() {
  const { isSupabaseConfigured } = await import('./env');
  if (!isSupabaseConfigured()) return null;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
