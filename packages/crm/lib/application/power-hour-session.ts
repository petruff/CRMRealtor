/**
 * Power Hour keeps its whole session in the URL so a refresh, a phone lock or
 * a back button never loses progress, and nothing is stored server-side.
 * All values are untrusted and bounded.
 */

export interface PowerHourSession {
  readonly done: number;
  readonly skip: readonly string[];
}

const MAX_SKIPS = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;

export function parsePowerHourSession(params: Readonly<{ done?: string; skip?: string }>): PowerHourSession {
  const done = Number(params.done ?? '0');
  const skip = (params.skip ?? '').split(',').map((value) => value.trim()).filter((value) => ID_PATTERN.test(value));
  return {
    done: Number.isSafeInteger(done) && done >= 0 && done <= 1_000 ? done : 0,
    skip: [...new Set(skip)].slice(0, MAX_SKIPS),
  };
}

export function powerHourHref(session: PowerHourSession): string {
  const params = new URLSearchParams();
  if (session.done > 0) params.set('done', String(session.done));
  if (session.skip.length) params.set('skip', session.skip.join(','));
  const query = params.toString();
  return `/power-hour${query ? `?${query}` : ''}`;
}
