import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSessionPublicPath, safeInternalPath } from '@/lib/routing/route-policy';

/**
 * Refreshes the Supabase session on every request and gates the app behind
 * sign-in.
 *
 * No-op when Supabase is unconfigured, which is what keeps the seeded demo
 * usable — otherwise every route would bounce to a login page that cannot work.
 */

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!url || !anonKey) return NextResponse.next();

  const { pathname } = request.nextUrl;
  // Public endpoints perform their own authorization where required. Avoiding
  // an unnecessary remote session refresh keeps health, OAuth callbacks,
  // webhooks, login and sign-out reachable even when Auth is degraded.
  if (isSessionPublicPath(pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        // Vercel stops middleware after 25 seconds. Fail closed with enough
        // time left to return the welcome route instead of a platform 504.
        signal: AbortSignal.timeout(6_000),
      }),
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getClaims cryptographically validates modern asymmetric tokens locally;
  // legacy tokens still fall back to the Auth server through the bounded fetch.
  let authenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && typeof data?.claims?.sub === 'string';
  } catch (error) {
    console.warn('Supabase session verification timed out; access failed closed.', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  if (!authenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/welcome';
    const next = safeInternalPath(`${pathname}${request.nextUrl.search}`);
    loginUrl.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
