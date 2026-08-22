/**
 * Supabase configuration detection.
 *
 * The app is designed to run without credentials so the UI can be demonstrated
 * and designed against before any cloud project exists. Everything auth- and
 * database-related keys off this one check, so there is exactly one place that
 * decides "are we live yet".
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/** Throws rather than letting a half-configured client fail obscurely later. */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).',
    );
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}
