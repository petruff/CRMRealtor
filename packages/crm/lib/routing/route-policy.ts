const PUBLIC_PAGE_PATHS = new Set(["/welcome", "/login", "/offline"]);

const SESSION_PUBLIC_PREFIXES = [
  "/manifest.webmanifest",
  "/sw.js",
  "/auth",
  "/api/health",
  "/api/readiness",
  "/api/intake",
  "/api/v1",
  "/api/internal/connectors/drain",
  "/api/internal/push/morning-brief",
  "/api/connectors/google/gmail/push",
  "/api/connectors/mailchimp/webhook",
  "/api/connectors/meta/webhook",
  "/api/connectors/twilio",
] as const;

const SAFE_DESTINATIONS = [
  "/",
  "/contacts",
  "/activities",
  "/mailers",
  "/connections",
  "/workspace",
  "/pipeline",
  "/insights",
  "/omnix",
  "/settings",
  "/inbox",
  "/capture",
  "/power-hour",
  "/open-house",
] as const;

function matchesSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PAGE_PATHS.has(pathname);
}

export function isSessionPublicPath(pathname: string): boolean {
  return (
    isPublicPagePath(pathname) ||
    SESSION_PUBLIC_PREFIXES.some((prefix) => matchesSegment(pathname, prefix))
  );
}

export function isApprovedInternalPath(pathname: string): boolean {
  return SAFE_DESTINATIONS.some((prefix) =>
    prefix === "/" ? pathname === "/" : matchesSegment(pathname, prefix),
  );
}

/**
 * Returns a same-origin application destination or a known-safe fallback.
 *
 * The value can originate in a query string, so the policy rejects absolute
 * URLs, protocol-relative URLs, encoded separators, control characters and
 * every top-level path not owned by the current Omnix application.
 */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  const safeFallback = isApprovedInternalPath(fallback) ? fallback : "/";
  if (!value || value !== value.trim()) return safeFallback;
  if (!value.startsWith("/") || value.startsWith("//")) return safeFallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return safeFallback;
  const rawPathname = value.split(/[?#]/, 1)[0] ?? value;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i.test(rawPathname))
    return safeFallback;

  try {
    const base = new URL("https://omnix.invalid");
    const parsed = new URL(value, base);
    if (
      parsed.origin !== base.origin ||
      !isApprovedInternalPath(parsed.pathname)
    ) {
      return safeFallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return safeFallback;
  }
}
