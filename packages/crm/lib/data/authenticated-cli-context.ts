import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceAuthorityError, type WorkspaceScope } from '../domain/workspace.ts';
import { resolveSupabaseWorkspaceScope } from './supabase-workspace-scope.ts';

export interface AuthenticatedCliEnvironment {
  readonly NEXT_PUBLIC_SUPABASE_URL?: string;
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly OMNIX_SUPABASE_ACCESS_TOKEN?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface AuthenticatedCliContext {
  readonly client: SupabaseClient;
  readonly scope: WorkspaceScope;
  readonly userEmail?: string;
}

interface AuthenticatedCliContextDependencies {
  readonly environment?: AuthenticatedCliEnvironment;
  readonly clientFactory?: typeof createClient;
  readonly scopeResolver?: typeof resolveSupabaseWorkspaceScope;
}

function decodedJwtRole(value: string): string | undefined {
  const segments = value.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || !payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

function validSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '::1';
    return !url.username
      && !url.password
      && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback));
  } catch {
    return false;
  }
}

/**
 * Authenticates live CLI commands as an end user. It deliberately accepts only
 * the public project key plus a short-lived access token; service-role
 * credentials and sample fallbacks have no path through this helper.
 */
export async function createAuthenticatedCliContext(
  dependencies: AuthenticatedCliContextDependencies = {},
): Promise<AuthenticatedCliContext> {
  const environment = dependencies.environment ?? process.env;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const accessToken = environment.OMNIX_SUPABASE_ACCESS_TOKEN?.trim();
  if (!url || !publicKey || !accessToken) {
    throw new WorkspaceAuthorityError(
      'invalid-input',
      'Live mode refused: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and OMNIX_SUPABASE_ACCESS_TOKEN.',
    );
  }
  if (!validSupabaseUrl(url)) {
    throw new WorkspaceAuthorityError(
      'invalid-input',
      'Live mode refused: Supabase URL must be HTTPS or a local loopback URL.',
    );
  }
  if (
    publicKey.startsWith('sb_secret_')
    || decodedJwtRole(publicKey) === 'service_role'
    || environment.SUPABASE_SERVICE_ROLE_KEY?.trim() === publicKey
  ) {
    throw new WorkspaceAuthorityError(
      'forbidden',
      'Live mode refused: service-role and secret Supabase keys are not accepted.',
    );
  }
  if (accessToken === publicKey || accessToken.startsWith('sb_')) {
    throw new WorkspaceAuthorityError(
      'forbidden',
      'Live mode refused: OMNIX_SUPABASE_ACCESS_TOKEN must be an end-user access token.',
    );
  }

  const factory = dependencies.clientFactory ?? createClient;
  const client = factory(url, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new WorkspaceAuthorityError(
      'forbidden',
      'Live mode refused: the supplied end-user access token is invalid or expired.',
    );
  }
  const scope = await (dependencies.scopeResolver ?? resolveSupabaseWorkspaceScope)(
    client,
    data.user.id,
  );
  return {
    client,
    scope,
    ...(data.user.email ? { userEmail: data.user.email } : {}),
  };
}
