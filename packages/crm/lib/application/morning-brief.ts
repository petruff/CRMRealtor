import { ensureNextTouch } from '../domain/cadence.ts';
import type { Contact } from '../domain/contact.ts';
import { buildTriage } from '../domain/triage.ts';
import { buildFocusQueue } from './focus-queue.ts';

export interface MorningBrief {
  readonly title: string;
  readonly body: string;
  /** Same-origin path the notification opens. */
  readonly url: string;
  readonly count: number;
}

/**
 * The daily notification. Names appear only when the member opted in, because
 * a lock screen is not a private place. Returns undefined when nothing needs
 * her, so Omnix never pings just to say "nothing to do".
 */
export function buildMorningBrief(
  contacts: readonly Contact[],
  now: Date,
  options: { readonly showNames?: boolean; readonly openDeadlines?: number } = {},
): MorningBrief | undefined {
  const active = contacts.filter((contact) => !contact.archivedAt).map((contact) => ensureNextTouch(contact, now));
  const queue = buildFocusQueue(buildTriage(active, now), now);
  const deadlines = options.openDeadlines ?? 0;
  if (!queue.length && !deadlines) return undefined;
  const people = queue.length ? `${queue.length} ${queue.length === 1 ? 'person' : 'people'} to reach` : undefined;
  const dates = deadlines ? `${deadlines} deal ${deadlines === 1 ? 'deadline' : 'deadlines'}` : undefined;
  const title = `Good morning — ${[people, dates].filter(Boolean).join(' · ')}`;
  const firstNames = queue.slice(0, 3).map((item) => item.name);
  const body = options.showNames && firstNames.length
    ? `Start with ${firstNames.length === 1 ? firstNames[0] : `${firstNames.slice(0, -1).join(', ')} and ${firstNames[firstNames.length - 1]}`}.`
    : queue.length ? 'Tap to start your Power Hour.' : 'Tap to review today’s deal dates.';
  return { title, body, url: queue.length ? '/power-hour' : '/transactions', count: queue.length };
}
