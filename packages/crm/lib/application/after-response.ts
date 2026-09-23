import { after } from 'next/server';

/**
 * Runs non-critical work (like a notification) after the response is sent.
 * Outside a request (scripts, tests) it simply runs in the background. The
 * task must never throw into the caller.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  const safe = () => task().catch(() => undefined);
  try { after(safe); } catch { void safe(); }
}
