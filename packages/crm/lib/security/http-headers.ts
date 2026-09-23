/**
 * Response security headers for every route.
 *
 * Omnix loads no third-party scripts, fonts or images: fonts are self-hosted,
 * GSAP is bundled, and the only cross-origin browser traffic is Supabase (REST
 * + Realtime). The policy therefore allows exactly `self` plus the configured
 * Supabase origin. Next.js streams inline bootstrap scripts, so `script-src`
 * keeps 'unsafe-inline'; every other directive is strict (no framing, no
 * plugins, no foreign form targets, no base-URI rewriting).
 */

export interface SecurityHeaderOptions {
  readonly supabaseUrl?: string;
  readonly development?: boolean;
}

export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

function origin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function contentSecurityPolicy({ supabaseUrl, development = false }: SecurityHeaderOptions = {}): string {
  const supabase = origin(supabaseUrl);
  const realtime = supabase?.replace(/^http/u, 'ws');
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:'],
    'connect-src': ["'self'", ...(supabase ? [supabase] : []), ...(realtime ? [realtime] : []), ...(development ? ['ws:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    // Connector OAuth starts as same-origin navigation that redirects to the
    // provider; Chromium applies form-action to such redirects, so allow only
    // the three first-party authorization hosts Omnix integrates with.
    'form-action': ["'self'", 'https://accounts.google.com', 'https://login.mailchimp.com', 'https://www.facebook.com'],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!development) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

export function securityHeaders(options: SecurityHeaderOptions = {}): HeaderEntry[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Microphone is allowed only for this origin (voice capture); everything else is off.
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ...(options.development ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
  ];
}
