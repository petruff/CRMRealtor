import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './http-headers';

describe('security headers', () => {
  it('allows only self plus the configured Supabase origin for network traffic', () => {
    const csp = contentSecurityPolicy({ supabaseUrl: 'https://abc.supabase.co/rest/v1' });
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('*');
  });

  it('blocks framing, plugins, foreign forms and base rewriting', () => {
    const csp = contentSecurityPolicy();
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "base-uri 'self'", "frame-src 'none'"]) {
      expect(csp).toContain(directive);
    }
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('relaxes only what the dev server needs', () => {
    const csp = contentSecurityPolicy({ development: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(securityHeaders({ development: true }).map((header) => header.key)).not.toContain('Strict-Transport-Security');
  });

  it('ignores malformed or non-http Supabase configuration', () => {
    expect(contentSecurityPolicy({ supabaseUrl: 'javascript:alert(1)' })).toContain("connect-src 'self';");
    expect(contentSecurityPolicy({ supabaseUrl: 'not a url' })).toContain("connect-src 'self';");
  });

  it('ships the full production header set', () => {
    const keys = securityHeaders().map((header) => header.key);
    expect(keys).toEqual(expect.arrayContaining([
      'Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy',
      'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'Strict-Transport-Security',
    ]));
  });
});
